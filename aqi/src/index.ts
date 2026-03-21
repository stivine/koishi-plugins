import { Context, Schema, Logger } from 'koishi'
import axios, { AxiosInstance } from 'axios'
import { importPKCS8, SignJWT } from 'jose'

const logger = new Logger('aqi')

export const name = 'aqi'
export const inject = ['database'] as const

// ── 数据库扩展 ──────────────────────────────────────────────────────────────

declare module 'koishi' {
  interface Channel {
    aqiSubscriptions: AqiSubscription[]
  }
}

export interface AqiSubscription {
  /** 用户输入的原始城市名 */
  city: string
  /** API 返回的城市显示名 */
  cityName: string
  /** 纬度 */
  lat: number
  /** 经度 */
  lon: number
}

// ── 插件配置 ────────────────────────────────────────────────────────────────

export interface Config {
  /** 和风天气 EdDSA 私钥（PEM 格式，PKCS#8） */
  privateKey: string
  /** JWT Header 中的 kid */
  kid: string
  /** JWT Payload 中的 sub（开发者 ID） */
  sub: string
  /** 和风天气 API HOST（不含协议和路径） */
  apiHost: string
  pushHour?: number
  forward?: boolean
  llm?: {
    baseURL: string
    apiKey: string
    model: string
  }
}

export const Config: Schema<Config> = Schema.object({
  privateKey: Schema.string()
    .required()
    .role('secret')
    .description('和风天气 EdDSA 私钥，PEM 格式（-----BEGIN PRIVATE KEY----- 开头）'),
  kid: Schema.string()
    .required()
    .description('JWT kid，在和风天气控制台查看，例如 T45F5UHUNH'),
  sub: Schema.string()
    .required()
    .description('JWT sub，你的开发者 ID，例如 3HKR329JC3'),
  apiHost: Schema.string()
    .required()
    .description('和风天气 API HOST，例如 nh4y3kramk.re.qweatherapi.com'),
  pushHour: Schema.number()
    .default(9)
    .description('每日推送时间（0-23）'),
  forward: Schema.boolean()
    .default(true)
    .description('以转发聊天记录形式发送（开启后消息显示为卡片，关闭后为普通文本）'),
  llm: Schema.object({
    baseURL: Schema.string()
      .description('OpenAI 兼容接口地址，例如 https://api.deepseek.com/v1'),
    apiKey: Schema.string()
      .role('secret')
      .description('API Key'),
    model: Schema.string()
      .default('deepseek-chat')
      .description('模型名称'),
  }).description('大模型配置（不填则使用普通文本播报）'),
})

// ── 和风天气 API 类型 ─────────────────────────────────────────────────────────

interface QAqiIndex {
  code: string          // 'us-epa' | 'qaqi' | ...
  name: string
  aqi: number
  aqiDisplay: string
  category?: string
  primaryPollutant?: { code: string; name: string }
  health?: {
    effect?: string
    advice?: { generalPopulation?: string; sensitivePopulation?: string }
  }
}

interface QAqiResponse {
  indexes: QAqiIndex[]
  pollutants?: Array<{
    code: string
    name: string
    concentration: { value: number; unit: string }
  }>
}

interface QGeoLocation {
  name: string      // 城市名
  lat: string
  lon: string
  adm1: string      // 省
  adm2: string      // 市
  country: string
}

interface QGeoResponse {
  code: string
  location?: QGeoLocation[]
}

// ── JWT 自动签发与刷新 ────────────────────────────────────────────────────────

/** 提前多少秒刷新 JWT（默认 30 分钟） */
const JWT_REFRESH_BEFORE = 30 * 60

class JwtManager {
  private token = ''
  private expAt = 0   // unix seconds

  constructor(
    private readonly privateKeyPem: string,
    private readonly kid: string,
    private readonly sub: string,
  ) {}

  /** 返回当前有效 token，必要时自动重签 */
  async get(): Promise<string> {
    if (Date.now() / 1000 < this.expAt - JWT_REFRESH_BEFORE) return this.token
    return this.refresh()
  }

  async refresh(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const exp = now + 23 * 3600
    const key = await importPKCS8(this.privateKeyPem, 'EdDSA')
    this.token = await new SignJWT({ sub: this.sub })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.kid })
      .setIssuedAt(now - 30)   // 留 30s 时钟偏差余量
      .setExpirationTime(exp)
      .sign(key)
    this.expAt = exp
    logger.info(`JWT 已刷新，有效期至 ${new Date(exp * 1000).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
    return this.token
  }
}

// ── HTTP 客户端工厂 ───────────────────────────────────────────────────────────

function makeClient(apiHost: string): AxiosInstance {
  return axios.create({
    baseURL: `https://${apiHost}`,
    decompress: true,
    timeout: 10000,
  })
}

// ── 地理编码：城市名 → 经纬度 ────────────────────────────────────────────────

interface GeoResult {
  cityName: string
  lat: number
  lon: number
}

async function geocode(client: AxiosInstance, jwtMgr: JwtManager, keyword: string): Promise<GeoResult | null> {
  try {
    const res = await client.get<QGeoResponse>('/geo/v2/city/lookup', {
      params: { location: keyword, lang: 'zh', number: 1 },
      headers: { Authorization: `Bearer ${await jwtMgr.get()}` },
    })
    if (res.data.code !== '200' || !res.data.location?.length) {
      logger.warn(`地理编码失败 (${keyword}): code=${res.data.code}`)
      return null
    }
    const loc = res.data.location[0]
    // 城市名：优先用 adm2（地级市），国外则用 name
    const cityName = (loc.country === '中国' || loc.country === 'China')
      ? (loc.adm2 || loc.name)
      : loc.name
    return { cityName, lat: parseFloat(loc.lat), lon: parseFloat(loc.lon) }
  } catch (err) {
    if (err.response?.status === 401) {
      logger.error(`地理编码鉴权失败 (${keyword})：私钥或 kid/sub 配置可能有误`)
    } else {
      logger.error(`地理编码请求失败 (${keyword}): ${err.message}`)
    }
    return null
  }
}

// ── 获取 AQI ─────────────────────────────────────────────────────────────────

async function fetchAqi(client: AxiosInstance, jwtMgr: JwtManager, lat: number, lon: number): Promise<QAqiResponse | null> {
  try {
    const res = await client.get<QAqiResponse>(
      `/airquality/v1/current/${lat}/${lon}`,
      { headers: { Authorization: `Bearer ${await jwtMgr.get()}` } },
    )
    if (!res.data.indexes?.length) {
      logger.warn(`AQI 返回数据为空 (${lat},${lon})`)
      return null
    }
    return res.data
  } catch (err) {
    if (err.response?.status === 401) {
      logger.error(`AQI 请求鉴权失败 (${lat},${lon})：私钥或 kid/sub 配置可能有误`)
    } else {
      logger.error(`获取 AQI 失败 (${lat},${lon}): ${err.message}`)
    }
    return null
  }
}

// ── 大模型润色 ───────────────────────────────────────────────────────────────

interface LlmConfig { baseURL: string; apiKey: string; model: string }

async function llmPolish(raw: string, llm: LlmConfig): Promise<string> {
  try {
    const res = await axios.post(
      `${llm.baseURL.replace(/\/$/, '')}/chat/completions`,
      {
        model: llm.model,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content:
              '你是毒舌但关心人的空气质量播报员。用简短口语把数据改写成播报，风格辛辣有趣，' +
              '必要时加表情符号，绝不废话。所有城市写在一段话里，100字以内，不加markdown。',
          },
          { role: 'user', content: raw },
        ],
      },
      {
        headers: { Authorization: `Bearer ${llm.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      },
    )
    return res.data.choices?.[0]?.message?.content?.trim() ?? raw
  } catch (err) {
    logger.warn(`大模型润色失败，回退到原始文本: ${err.message}`)
    return raw
  }
}

// ── 构建消息 ─────────────────────────────────────────────────────────────────

interface BuildOptions {
  sub: AqiSubscription
  forward: boolean
  llm?: LlmConfig
}

function buildRaw(data: QAqiResponse, sub: AqiSubscription): string {
  const idx = data.indexes[0]
  const aqi = Math.round(idx.aqi)
  const category = idx.category ?? idx.aqiDisplay ?? String(aqi)
  const primary = idx.primaryPollutant?.name ?? ''
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })

  const lines: string[] = []
  lines.push(`📊 【AQI 播报】${sub.cityName} · ${date}`)
  lines.push(`当前 AQI（${idx.name}）：${aqi}（${category}）${primary ? `  主污染物：${primary}` : ''}`)

  // 健康建议（API 提供）
  const generalAdvice = idx.health?.advice?.generalPopulation
  if (generalAdvice) lines.push(`建议：${generalAdvice}`)

  // 主要污染物浓度
  if (data.pollutants?.length) {
    const parts = data.pollutants
      .filter(p => p.concentration?.value != null)
      .map(p => `${p.name} ${p.concentration.value}${p.concentration.unit}`)
    if (parts.length) lines.push(`污染物：${parts.join('  ')}`)
  }

  return lines.join('\n')
}

/** 单城市查询（保持原有逻辑） */
async function buildMessage(data: QAqiResponse, opts: BuildOptions): Promise<string> {
  const raw = buildRaw(data, opts.sub)
  const content = opts.llm ? await llmPolish(raw, opts.llm) : raw
  return opts.forward ? `<message forward><author id=""/>${content}</message>` : content
}

/** 多城市聚合播报（定时推送用） */
async function buildBatchMessage(
  entries: Array<{ data: QAqiResponse; sub: AqiSubscription }>,
  forward: boolean,
  llm?: LlmConfig,
): Promise<string> {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const blocks = entries.map(({ data, sub }) => {
    const idx = data.indexes[0]
    const aqi = Math.round(idx.aqi)
    const category = idx.category ?? idx.aqiDisplay ?? String(aqi)
    const primary = idx.primaryPollutant?.name ?? ''
    const lines: string[] = []
    lines.push(`【${sub.cityName}】AQI（${idx.name}）${aqi}（${category}）${primary ? `  主污染物：${primary}` : ''}`)
    const generalAdvice = idx.health?.advice?.generalPopulation
    if (generalAdvice) lines.push(`  建议：${generalAdvice}`)
    if (data.pollutants?.length) {
      const parts = data.pollutants
        .filter(p => p.concentration?.value != null)
        .map(p => `${p.name} ${p.concentration.value}${p.concentration.unit}`)
      if (parts.length) lines.push(`  污染物：${parts.join('  ')}`)
    }
    return lines.join('\n')
  })

  const raw = `📊 【每日 AQI 播报】${date}\n\n${blocks.join('\n\n')}`
  const content = llm ? await llmPolish(raw, llm) : raw
  return forward ? `<message forward><author id=""/>${content}</message>` : content
}

// ── 主插件 ───────────────────────────────────────────────────────────────────

export function apply(ctx: Context, config: Config) {
  if (!config?.privateKey || !config?.kid || !config?.sub || !config?.apiHost) {
    logger.error('缺少必要配置：privateKey / kid / sub / apiHost 不能为空')
    return
  }

  ctx.model.extend('channel', { aqiSubscriptions: 'json' })

  const { privateKey, kid, sub, apiHost, pushHour, forward: forwardDefault, llm } = config
  const jwtMgr = new JwtManager(privateKey, kid, sub)
  const client = makeClient(apiHost)

  // 启动时立即签发一次，提前暴露配置错误
  jwtMgr.refresh().catch(err => logger.error(`JWT 初始签发失败：${err.message}`))

  // ── 定时推送 ──────────────────────────────────────────────────────────────
  let lastPushDate = ''

  ctx.setInterval(async () => {
    const dateStr = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const hour = parseInt(
      new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Shanghai' }),
      10,
    )
    if (hour !== pushHour || dateStr === lastPushDate) return
    lastPushDate = dateStr

    logger.info(`开始执行每日 AQI 推送（${dateStr}）`)
    const channels = await ctx.database.getAssignedChannels(['platform', 'id', 'aqiSubscriptions'])

    for (const channel of channels) {
      const subs: AqiSubscription[] = Array.isArray(channel.aqiSubscriptions) ? channel.aqiSubscriptions : []
      if (!subs.length) continue
      const guildId = `${channel.platform}:${channel.id}`

      // 并发获取所有城市数据
      const results = await Promise.all(
        subs.map(async sub => {
          const data = await fetchAqi(client, jwtMgr, sub.lat, sub.lon)
          if (!data) { logger.warn(`推送失败：无法获取 ${sub.city} 的数据`); return null }
          return { data, sub }
        }),
      )
      const entries = results.filter((r): r is { data: QAqiResponse; sub: AqiSubscription } => r !== null)
      if (!entries.length) continue

      // 聚合成一条消息发送
      const message = await buildBatchMessage(entries, forwardDefault, llm)
      await ctx.broadcast([guildId], message)
    }
  }, 60 * 1000)

  // ── 指令 ──────────────────────────────────────────────────────────────────

  const guild = ctx.guild()

  // aqi.push：立即触发聚合播报（测试定时推送用）
  guild
    .command('aqi.push', '立即触发当前频道的聚合播报')
    .action(async ({ session }) => {
      const platform = session.platform
      const channelId = session.channelId
      const [channelRow] = await ctx.database.get('channel', { platform, id: channelId }, ['aqiSubscriptions'])
      const subs: AqiSubscription[] = Array.isArray(channelRow?.aqiSubscriptions) ? channelRow.aqiSubscriptions : []
      if (!subs.length) return '当前频道没有订阅任何城市，无法推送。'

      // await session.send('正在拉取数据，请稍候……')

      const results = await Promise.all(
        subs.map(async sub => {
          const data = await fetchAqi(client, jwtMgr, sub.lat, sub.lon)
          if (!data) { logger.warn(`测试推送：无法获取 ${sub.city} 的数据`); return null }
          return { data, sub }
        }),
      )
      const entries = results.filter((r): r is { data: QAqiResponse; sub: AqiSubscription } => r !== null)
      if (!entries.length) return '所有城市数据均获取失败，请稍后再试。'

      return buildBatchMessage(entries, forwardDefault, llm)
    })

  // aqi：查询 / 订阅 / 管理
  guild
    .command('aqi [city]', '订阅/查询 AQI 空气质量')
    .channelFields(['aqiSubscriptions', 'id', 'platform'])
    .option('list',      '-l  查看订阅列表')
    .option('remove',    '-r  取消订阅')
    .option('subscribe', '-s  订阅每日推送')
    .action(async ({ session, options }, city) => {
      const channel = session.channel
      if (!Array.isArray(channel.aqiSubscriptions)) channel.aqiSubscriptions = []
      const subs = channel.aqiSubscriptions

      // 查看列表
      if (options.list) {
        if (!subs.length) return '当前频道未订阅任何城市的 AQI。'
        return '当前 AQI 订阅列表：\n' +
          subs.map((s, i) => `${i + 1}. ${s.cityName}（${s.city}）`).join('\n')
      }

      if (!city) return [
        '用法：',
        '  aqi <城市>       查询实时 AQI',
        '  aqi <城市> -s    订阅每日推送',
        '  aqi <城市> -r    取消订阅',
        '  aqi -l           查看订阅列表',
        '  aqi.push         立即触发播报',
      ].join('\n')

      // 取消订阅
      if (options.remove) {
        const idx = subs.findIndex(s =>
          s.city.toLowerCase() === city.toLowerCase() || s.cityName === city,
        )
        if (idx < 0) return `未订阅城市"${city}"。`
        subs.splice(idx, 1)
        return `已取消订阅 "${city}" 的 AQI 推送。`
      }

      // 订阅 / 立即查询：都需要先地理编码
      // await session.send(`正在查询 "${city}"，请稍候……`)
      const geo = await geocode(client, jwtMgr, city)
      if (!geo) return `找不到城市"${city}"，请检查名称（支持中英文，如"苏州"或"suzhou"）。`

      const data = await fetchAqi(client, jwtMgr, geo.lat, geo.lon)
      if (!data) return `获取 "${geo.cityName}" 的 AQI 数据失败，请稍后重试。`

      // ── 订阅
      if (options.subscribe) {
        const existing = subs.find(s =>
          s.city.toLowerCase() === city.toLowerCase() || s.cityName === geo.cityName,
        )
        if (existing) return `"${geo.cityName}" 已在订阅列表中。`
        subs.push({ city: city.toLowerCase(), cityName: geo.cityName, lat: geo.lat, lon: geo.lon })

        const idx = data.indexes[0]
        const aqi = Math.round(idx.aqi)
        const category = idx.category ?? idx.aqiDisplay ?? String(aqi)
        return `✅ "${geo.cityName}" 订阅成功！每天 ${pushHour}:00 推送。\n当前 AQI：${aqi}（${category}）`
      }

      // ── 立即查询
      const sub: AqiSubscription = {
        city,
        cityName: geo.cityName,
        lat: geo.lat,
        lon: geo.lon,
      }
      return buildMessage(data, { sub, forward: forwardDefault, llm })
    })
}

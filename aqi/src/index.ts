import { Context, Schema, Logger } from 'koishi'
import axios from 'axios'

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
  /** 查询用的城市关键字，如 "suzhou" */
  city: string
  /** 展示给用户的城市名，如 "苏州" */
  cityName: string
  /** AQI 报警阈值，超过此值时发出警告 */
  threshold: number
}

// ── 插件配置 ────────────────────────────────────────────────────────────────

export interface Config {
  token: string
  /** 每日推送时间（小时，本地时间，默认 9） */
  pushHour?: number
  /** 默认报警阈值 */
  defaultThreshold?: number
  /** 是否默认以转发消息形式发送 */
  forward?: boolean
}

export const Config: Schema<Config> = Schema.object({
  token: Schema.string()
    .required()
    .description('WAQI API Token，前往 https://aqicn.org/data-platform/token/ 申请'),
  pushHour: Schema.number()
    .default(9)
    .description('每日推送时间（0-23，本地时间）'),
  defaultThreshold: Schema.number()
    .default(100)
    .description('默认 AQI 报警阈值，超过此值时警告'),
  forward: Schema.boolean()
    .default(true)
    .description('是否默认以转发聊天记录形式发送消息'),
})

// ── AQI 等级描述 ─────────────────────────────────────────────────────────────

interface AqiGrade {
  label: string
  advice: string
}

function aqiGrade(aqi: number): AqiGrade {
  if (aqi <= 50)  return { label: '优 🟢',      advice: '出门浪 🌿' }
  if (aqi <= 100) return { label: '良 🟡',      advice: '空气正常 😌' }
  if (aqi <= 150) return { label: '轻度污染 🟠', advice: '今天空气一般般 😐' }
  if (aqi <= 200) return { label: '中度污染 🔴', advice: '少折腾 😷' }
  if (aqi <= 300) return { label: '重度污染 🟣', advice: '少出门 🚫' }
  return           { label: '严重污染 ⚫',       advice: '锁死在家 ☠️' }
}

/** 仅返回等级标签，用于预报中 */
function aqiLevel(aqi: number): string {
  return aqiGrade(aqi).label
}

// ── WAQI API ─────────────────────────────────────────────────────────────────

interface WaqiResponse {
  status: string
  data: {
    aqi: number | string  // API 数据暂缺时返回字符串 "-"
    city: {
      name: string
      location: string
    }
    time: {
      s: string
    }
    forecast?: {
      daily?: {
        pm25?: Array<{ avg: number; day: string; max: number; min: number }>
        pm10?: Array<{ avg: number; day: string; max: number; min: number }>
      }
    }
  }
}

interface SearchStation {
  uid: number
  aqi: number | string
  time: { stime: string }
  station: { name: string; url: string }
}

/** 用 search API 找第一个 AQI 有效的站点 url，找不到返回 null */
async function searchBestStation(keyword: string, token: string): Promise<string | null> {
  try {
    const url = `https://api.waqi.info/search/?token=${token}&keyword=${encodeURIComponent(keyword)}`
    const res = await axios.get<{ status: string; data: SearchStation[] }>(url, { timeout: 10000 })
    if (res.data.status !== 'ok') return null
    const best = res.data.data.find(s => typeof s.aqi === 'number' || (typeof s.aqi === 'string' && s.aqi !== '-'))
    return best ? best.station.url : null
  } catch (err) {
    logger.error(`搜索站点失败 (${keyword}): ${err.message}`)
    return null
  }
}

async function fetchAqi(city: string, token: string): Promise<WaqiResponse['data'] | null> {
  try {
    // 先直接尝试 feed，大多数城市可直接命中
    const directUrl = `https://api.waqi.info/feed/${encodeURIComponent(city)}/?token=${token}`
    const res = await axios.get<WaqiResponse>(directUrl, { timeout: 10000 })

    if (res.data.status === 'ok' && typeof res.data.data.aqi === 'number') {
      // 直接命中且数据有效
      return res.data.data
    }

    // 直接命中但 aqi 为 "-"（站点无数据），用 search 找有效站点
    logger.debug(`${city} 直接查询无有效数据，尝试 search API…`)
    const stationUrl = await searchBestStation(city, token)
    if (!stationUrl) {
      // search 也没有有效站点，返回原始（无数据）结果
      return res.data.status === 'ok' ? res.data.data : null
    }

    // 用找到的站点 url 重新查询
    const fallbackUrl = `https://api.waqi.info/feed/${stationUrl}/?token=${token}`
    const fallbackRes = await axios.get<WaqiResponse>(fallbackUrl, { timeout: 10000 })
    if (fallbackRes.data.status === 'ok') return fallbackRes.data.data

    return null
  } catch (err) {
    logger.error(`获取 ${city} AQI 失败: ${err.message}`)
    return null
  }
}

// ── 构建推送消息 ──────────────────────────────────────────────────────────────

function buildMessage(data: WaqiResponse['data'], sub: AqiSubscription, forward = false): string {
  const rawAqi = data.aqi
  const cityDisplay = sub.cityName || data.city.name
  const lines: string[] = []

  // API 数据暂缺时 aqi 为字符串 "-"
  if (typeof rawAqi !== 'number') {
    lines.push(`📊 【AQI 预报】${cityDisplay} · ${data.time.s.slice(0, 10)}`)
    lines.push(`当前 AQI：暂无数据（监测站数据未上报）`)
  } else {
    const aqi = rawAqi
    const { label, advice } = aqiGrade(aqi)

    // 判断是否超阈值：超阈值时警告独占一行放在最前
    if (aqi > sub.threshold) {
      lines.push(`⚠️ 【AQI 警告】当前 AQI 为：${aqi}，请 ${cityDisplay} 的居民注意！`)
    }

    // 每日预报标题
    lines.push(`📊 【AQI 预报】${cityDisplay} · ${data.time.s.slice(0, 10)}`)
    lines.push(`当前 AQI：${aqi}（${label}）`)
    lines.push(`建议：${advice}`)

    // 明日预报
    const forecasts = data.forecast?.daily?.pm25
    if (forecasts && forecasts.length >= 2) {
      const today = new Date().toISOString().slice(0, 10)
      const tomorrow = forecasts.find(f => f.day > today)
      if (tomorrow) {
        const { label: tLabel, advice: tAdvice } = aqiGrade(tomorrow.avg)
        lines.push(`明日预报 (PM2.5)：均值 ${tomorrow.avg}，最高 ${tomorrow.max}，最低 ${tomorrow.min}（${tLabel} · ${tAdvice}）`)
      }
    }
  }

  const content = lines.join('\n')
  return forward ? `<message forward><author id=""/>${content}</message>` : content
}

// ── 主插件 ───────────────────────────────────────────────────────────────────

export function apply(ctx: Context, config: Config) {
  // 扩展数据库 Channel 模型
  ctx.model.extend('channel', {
    aqiSubscriptions: 'json',
  })

  const { token, pushHour, defaultThreshold, forward: forwardDefault } = config

  // ── 定时推送 ──────────────────────────────────────────────────────────────
  // 每分钟检查一次，到达目标小时的整点时触发推送
  let lastPushDate = ''

  ctx.setInterval(async () => {
    const now = new Date()
    const dateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const hour = parseInt(
      new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Shanghai' }),
      10,
    )

    // 每天只在目标小时推送一次
    if (hour !== pushHour || dateStr === lastPushDate) return
    lastPushDate = dateStr

    logger.info(`开始执行每日 AQI 推送（${dateStr}）`)

    // 查询所有有订阅的频道
    const channels = await ctx.database.getAssignedChannels(['platform', 'id', 'aqiSubscriptions'])

    for (const channel of channels) {
      const subs: AqiSubscription[] = Array.isArray(channel.aqiSubscriptions) ? channel.aqiSubscriptions : []
      if (!subs.length) continue

      const guildId = `${channel.platform}:${channel.id}`

      for (const sub of subs) {
        const data = await fetchAqi(sub.city, token)
        if (!data) {
          logger.warn(`推送失败：无法获取 ${sub.city} 的 AQI 数据`)
          continue
        }
        const message = buildMessage(data, sub, forwardDefault)
        await ctx.broadcast([guildId], message)
        logger.debug(`已推送 ${sub.city} AQI 到 ${guildId}`)
      }
    }
  }, 60 * 1000) // 每分钟检查一次

  // ── 指令定义 ──────────────────────────────────────────────────────────────

  ctx.guild()
    .command('aqi [city]', '订阅/查询 AQI 空气质量')
    .channelFields(['aqiSubscriptions', 'id', 'platform'])
    .option('list', '-l 查看已订阅的城市')
    .option('remove', '-r 取消订阅指定城市')
    .option('threshold', '-t <threshold:number> 设置报警阈值（默认100）')
    .option('subscribe', '-s 订阅每日推送')
    .option('forward', '-f 以转发聊天记录形式发送（覆盖全局配置）')
    .option('noForward', '-F 以普通消息形式发送（覆盖全局配置）')
    .action(async ({ session, options }, city) => {
      const channel = session.channel
      if (!Array.isArray(channel.aqiSubscriptions)) channel.aqiSubscriptions = []
      const subs: AqiSubscription[] = channel.aqiSubscriptions

      // -f / -F 覆盖全局 forward 配置，否则使用全局默认
      const useForward = options.forward ? true : options.noForward ? false : forwardDefault

      // ── 查看订阅列表 ────────────────────────────────────────────────────
      if (options.list) {
        if (!subs.length) return '当前频道未订阅任何城市的 AQI。'
        const list = subs.map(
          (s, i) => `${i + 1}. ${s.cityName}（${s.city}）  阈值：${s.threshold}`,
        )
        return `当前 AQI 订阅列表：\n${list.join('\n')}`
      }

      if (!city) return '用法：\naqi <城市>          查询实时 AQI\naqi <城市> -s       订阅每日推送\naqi <城市> -r       取消订阅\naqi -l              查看订阅列表'

      // ── 取消订阅 ────────────────────────────────────────────────────────
      if (options.remove) {
        const idx = subs.findIndex(
          s => s.city.toLowerCase() === city.toLowerCase() || s.cityName === city,
        )
        if (idx < 0) return `未订阅城市"${city}"。`
        subs.splice(idx, 1)
        return `已取消订阅 "${city}" 的 AQI 推送。`
      }

      // ── 订阅 ────────────────────────────────────────────────────────────
      if (options.subscribe) {
        await session.send(`正在查询 "${city}" 的 AQI 数据，请稍候……`)
        const data = await fetchAqi(city, token)
        if (!data) return `无法获取 "${city}" 的 AQI 数据，请检查城市名称是否正确（建议使用英文，如 suzhou）。`

        const existing = subs.find(
          s => s.city.toLowerCase() === city.toLowerCase() || s.cityName === city,
        )
        const threshold = options.threshold ?? defaultThreshold

        if (existing) {
          existing.threshold = threshold
          return `已更新 "${data.city.name}" 的 AQI 报警阈值为 ${threshold}。`
        }

        subs.push({
          city: city.toLowerCase(),
          cityName: data.city.name,
          threshold,
        })

        return [
          `✅ AQI "${data.city.name}" 订阅成功！`,
          `将于每天 ${pushHour}:00 推送空气质量预报，AQI 超过 ${threshold} 时发出警告。`,
          `当前 AQI：${data.aqi}（${typeof data.aqi === 'number' ? aqiLevel(data.aqi) : '暂无数据'}）`,
        ].join('\n')
      }

      // ── 默认：立即查询 ──────────────────────────────────────────────────
      const data = await fetchAqi(city, token)
      if (!data) return `无法获取 "${city}" 的 AQI 数据，请检查城市名称是否正确（建议使用英文，如 suzhou）。`
      const fakeSub: AqiSubscription = {
        city,
        cityName: data.city.name,
        threshold: options.threshold ?? defaultThreshold,
      }
      return buildMessage(data, fakeSub, useForward)
    })
}

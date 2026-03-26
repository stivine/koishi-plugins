import { Context, Logger, Schema, Session, Time } from 'koishi'

const logger = new Logger('agent-gateway')

export const name = 'agent-gateway'
export const inject = ['http'] as const

export interface AgentRequestBody {
  traceId: string
  sessionKey: string
  timestamp: number
  event: 'message'
  message: {
    id?: string
    content: string
    quote?: string
  }
  user: {
    id?: string
    name?: string
  }
  channel: {
    id?: string
    guildId?: string
    isDirect: boolean
  }
  platform: {
    name: string
    selfId?: string
  }
  metadata?: Record<string, unknown>
}

export interface AgentReplyAction {
  type: 'reply'
  content: string
}

export interface AgentStopAction {
  type: 'stop'
}

export type AgentAction = AgentReplyAction | AgentStopAction

export interface AgentResponseBody {
  actions?: AgentAction[]
  reply?: string
  segments?: string[]
}

export interface Config {
  endpoint: string
  apiKey?: string
  timeout: number
  enabledGroupIds: string[]
  triggerMode: 'mention-or-private' | 'always' | 'private-only'
  captureGroupContext: boolean
  commandName: string
  commandBypassSilence: boolean
  passthroughMetadata: boolean
  adminNotifyUserId?: string
  adminNotifyPlatform?: string
}

export const Config: Schema<Config> = Schema.object({
  endpoint: Schema.string().required().description('Agent 服务接口地址，例如 http://127.0.0.1:8000/chat'),
  apiKey: Schema.string().role('secret').description('可选：Agent 服务鉴权 key。'),
  timeout: Schema.number().default(Time.second * 20).description('请求 Agent 的超时毫秒数。'),
  enabledGroupIds: Schema.array(String).default([]).description('可选：仅这些群号启用网关处理；留空表示所有群都启用。'),
  triggerMode: Schema.union([
    Schema.const('mention-or-private').description('仅在 @机器人 或私聊时自动触发。'),
    Schema.const('always').description('所有消息都触发。'),
    Schema.const('private-only').description('仅私聊触发。'),
  ]).default('mention-or-private').description('自动触发条件。'),
  captureGroupContext: Schema.boolean().default(true).description('是否采集群聊中未触发自动回复的消息，用于共享上下文记忆。'),
  commandName: Schema.string().default('agent.chat').description('手动触发命令名。'),
  commandBypassSilence: Schema.boolean().default(true).description('手动命令是否绕过 Agent 的 stop 行为。'),
  passthroughMetadata: Schema.boolean().default(true).description('是否将 session 额外字段透传给 Agent。'),
  adminNotifyUserId: Schema.string().description('可选：Agent 异常时通知的管理员用户 ID，不填则不通知。'),
  adminNotifyPlatform: Schema.string().description('可选：管理员所在平台（如 onebot），不填则使用当前会话平台。'),
})

function normalizeText(input: string) {
  return String(input || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sessionMeta(session: Session) {
  return `platform=${session.platform || 'unknown'} channel=${session.channelId || 'private'} guild=${session.guildId || 'none'} user=${session.userId || 'unknown'} subtype=${session.subtype || 'unknown'}`
}

function shortText(text: string, max = 80) {
  const s = normalizeText(text)
  if (s.length <= max) return s
  return `${s.slice(0, max)}...`
}

function isPrivateSession(session: Session) {
  const channelId = String(session.channelId || '')
  return session.subtype === 'private'
    || Boolean((session as any).isDirect)
    || channelId.startsWith('@')
}

function shouldTrigger(session: Session, config: Config) {
  // 不依赖单一字段，兼容 sandbox / 多适配器。
  const isPrivate = isPrivateSession(session)
  // 各适配器字段不一致，做更宽松的 @机器人 检测。
  const appel = Boolean(
    (session as any).stripped?.appel
    || (session as any).stripped?.hasAt
    || (session as any).parsed?.appel
    || (session as any).parsed?.hasAt
  )

  let triggered = false
  if (config.triggerMode === 'always') triggered = true
  else if (config.triggerMode === 'private-only') triggered = isPrivate
  else triggered = isPrivate || appel

  logger.info(`trigger check: mode=${config.triggerMode} isPrivate=${isPrivate} appel=${appel} triggered=${triggered} ${sessionMeta(session)}`)
  return triggered
}

function isLikelyCommand(content: string) {
  return /^([/.#]|agent\.)/.test(content.trim())
}

function isGroupMessage(session: Session) {
  // 某些适配器群消息可能不提供 guildId，不能只靠 guildId 判断。
  return !isPrivateSession(session) && Boolean(session.channelId)
}

function isGroupEnabled(session: Session, config: Config) {
  if (!isGroupMessage(session)) return true
  const allowed = (config.enabledGroupIds || []).map((x) => String(x || '').trim()).filter(Boolean)
  if (!allowed.length) return true
  return allowed.includes(String(session.channelId || '').trim())
}

function makeTraceId(session: Session) {
  const channelPart = session.channelId || 'private'
  const userPart = session.userId || 'unknown'
  return `${session.platform}-${channelPart}-${userPart}-${Date.now()}`
}

function buildSessionKey(session: Session) {
  const channelPart = session.channelId ? `${session.platform}:${session.channelId}` : `${session.platform}:private`
  return `${channelPart}:${session.userId || 'unknown'}`
}

function buildRequestBody(session: Session, text: string, traceId: string, config: Config): AgentRequestBody {
  const isDirect = isPrivateSession(session)

  return {
    traceId,
    sessionKey: buildSessionKey(session),
    timestamp: Date.now(),
    event: 'message',
    message: {
      id: session.messageId,
      content: text,
      quote: session.quote?.content,
    },
    user: {
      id: session.userId,
      name: session.username || session.author?.name || session.author?.nick,
    },
    channel: {
      id: session.channelId,
      guildId: session.guildId,
      isDirect,
    },
    platform: {
      name: session.platform,
      selfId: session.selfId,
    },
    metadata: config.passthroughMetadata
      ? {
          locales: session.locales,
          sid: session.sid,
          uid: session.uid,
          gid: session.gid,
        }
      : undefined,
  }
}

function responseToMessages(data: AgentResponseBody, bypassStop = false) {
  if (Array.isArray(data.actions) && data.actions.length) {
    const messages: string[] = []
    let stopped = false
    for (const action of data.actions) {
      if (action.type === 'stop' && !bypassStop) {
        stopped = true
        return { messages: [], stopped }
      }
      if (action.type === 'reply') {
        const msg = normalizeText(action.content)
        if (msg) messages.push(msg)
      }
    }
    return { messages, stopped }
  }

  if (Array.isArray(data.segments) && data.segments.length) {
    return { messages: data.segments.map(normalizeText).filter(Boolean), stopped: false }
  }

  const single = normalizeText(data.reply || '')
  return { messages: single ? [single] : [], stopped: false }
}

async function callAgent(ctx: Context, config: Config, body: AgentRequestBody) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-trace-id': body.traceId,
  }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`

  return ctx.http.post<AgentResponseBody>(config.endpoint, body, {
    timeout: config.timeout,
    headers,
  })
}

function toErrorMessage(error: unknown) {
  const msg = (error as Error)?.message || String(error)
  return normalizeText(msg).slice(0, 500)
}

async function notifyAdmin(ctx: Context, config: Config, session: Session, title: string, detail: string) {
  const adminUserId = config.adminNotifyUserId?.trim()
  if (!adminUserId) return
  const platform = config.adminNotifyPlatform?.trim() || session.platform
  const bot = ctx.bots.find((x) => x.platform === platform)
  if (!bot || typeof (bot as any).sendPrivateMessage !== 'function') {
    logger.warn(`admin notify skipped: no bot/sendPrivateMessage for platform=${platform}`)
    return
  }
  const text = `[agent-gateway] ${title}\nplatform=${session.platform}\nchannel=${session.channelId || 'private'}\nuser=${session.userId || 'unknown'}\ndetail=${detail}`
  try {
    await (bot as any).sendPrivateMessage(adminUserId, text)
  } catch (error) {
    logger.warn(`admin notify failed: ${toErrorMessage(error)}`)
  }
}

async function runGateway(
  ctx: Context,
  session: Session,
  text: string,
  config: Config,
  bypassStop = false,
  manual = false,
  observeOnly = false,
) {
  const traceId = makeTraceId(session)
  const body = buildRequestBody(session, text, traceId, config)
  body.metadata = {
    ...(body.metadata || {}),
    manual,
    observeOnly,
  }
  logger.info(
    `gateway dispatch: traceId=${traceId} manual=${manual} observeOnly=${observeOnly} bypassStop=${bypassStop} endpoint=${config.endpoint} sessionKey=${body.sessionKey} text="${shortText(text)}" ${sessionMeta(session)}`
  )

  let data: AgentResponseBody
  try {
    data = await callAgent(ctx, config, body)
  } catch (error) {
    const detail = `traceId=${traceId} reason=request_failed error=${toErrorMessage(error)}`
    logger.warn(`agent request failed: ${detail}`)
    await notifyAdmin(ctx, config, session, 'agent request failed', detail)
    return { messages: [], stopped: false }
  }

  const parsed = responseToMessages(data, bypassStop)
  // logger.info(
  //   `gateway response: traceId=${traceId} actionCount=${Array.isArray(data.actions) ? data.actions.length : 0} segmentCount=${Array.isArray(data.segments) ? data.segments.length : 0} hasReply=${Boolean(data.reply)} parsedMessages=${parsed.messages.length} stopped=${parsed.stopped}`
  // )
  if (!parsed.messages.length && !parsed.stopped) {
    const raw = normalizeText(JSON.stringify(data)).slice(0, 700)
    const detail = `traceId=${traceId} reason=empty_response body=${raw || '{}'}`.slice(0, 1000)
    logger.warn(`agent returned no sendable content: ${detail}`)
    await notifyAdmin(ctx, config, session, 'agent empty response', detail)
  }
  return parsed
}

export function apply(ctx: Context, config: Config) {
  // logger.info(
  //   `plugin enabled: endpoint=${config.endpoint} timeout=${config.timeout} triggerMode=${config.triggerMode} captureGroupContext=${config.captureGroupContext !== false} commandName=${config.commandName || 'agent.chat'} commandBypassSilence=${config.commandBypassSilence} passthroughMetadata=${config.passthroughMetadata}`
  // )
  ctx.middleware(async (session, next) => {
    // logger.info(`middleware in: type=${session.type || 'unknown'} content="${shortText(session.content || '')}" ${sessionMeta(session)}`)
    const eventType = String(session.type || '')
    const isMessageEvent = eventType === 'message' || eventType.startsWith('message-')
    if (!isMessageEvent) {
      logger.info(`skip: non-message event, type=${session.type || 'unknown'}`)
      return next()
    }
    if (!session.platform) {
      logger.warn(`skip: missing platform, ${sessionMeta(session)}`)
      return next()
    }
    if (session.userId === session.selfId || session.author?.isBot) {
      // logger.debug(`skip: bot/self message, ${sessionMeta(session)}`)
      return next()
    }
    if (!isGroupEnabled(session, config)) {
      logger.debug(`skip: group not enabled, channel=${session.channelId || 'unknown'} enabledGroups=${(config.enabledGroupIds || []).join(',') || '(all)'}`)
      return next()
    }

    const autoTriggered = shouldTrigger(session, config)
    const captureGroupContext = config.captureGroupContext !== false
    if (!autoTriggered) {
      const isGroup = isGroupMessage(session)
      // logger.info(`auto trigger off: isGroup=${isGroup} captureGroupContext=${captureGroupContext} ${sessionMeta(session)}`)
      if (captureGroupContext && isGroup) {
        const text = normalizeText(session.content)
        if (text && !isLikelyCommand(text)) {
          logger.debug(`observeOnly capture: channel=${session.channelId || 'unknown'} user=${session.userId || 'unknown'}`)
          await runGateway(ctx, session, text, config, true, false, true)
        } else {
          logger.debug(`observeOnly skip: emptyTextOrCommand text="${shortText(text)}"`)
        }
      }
      return next()
    }

    const text = normalizeText(session.content)
    if (!text) {
      logger.info(`auto trigger skip: empty normalized text ${sessionMeta(session)}`)
      return next()
    }
    if (isLikelyCommand(text)) {
      logger.info(`auto trigger skip: detected command text="${shortText(text)}"`)
      return next()
    }

    const result = await runGateway(ctx, session, text, config, false, false, false)
    if (!result.messages.length) {
      logger.info(`auto trigger no output: stopped=${result.stopped} ${sessionMeta(session)}`)
      return next()
    }

    for (const message of result.messages) {
      logger.info(`auto send: message="${shortText(message)}" ${sessionMeta(session)}`)
      await session.send(message)
    }
  })

  const commandName = config.commandName?.trim() || 'agent.chat'
  ctx.command(`${commandName} <text:text>`, '手动触发 Agent 网关')
    .action(async ({ session }, text) => {
      if (!text?.trim()) return '请输入内容。'
      if (!isGroupEnabled(session, config)) return '当前群未启用 Agent 网关。'
      logger.info(`manual command invoke: command=${commandName} text="${shortText(text)}" ${sessionMeta(session)}`)
      const result = await runGateway(ctx, session, text, config, config.commandBypassSilence, true, false)
      if (!result.messages.length) return ''
      for (const message of result.messages) {
        logger.info(`manual send: message="${shortText(message)}" ${sessionMeta(session)}`)
        await session.send(message)
      }
      return ''
    })
}

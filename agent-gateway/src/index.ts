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
  triggerMode: 'mention-or-private' | 'always' | 'private-only'
  captureGroupContext: boolean
  commandName: string
  commandBypassSilence: boolean
  passthroughMetadata: boolean
}

export const Config: Schema<Config> = Schema.object({
  endpoint: Schema.string().required().description('Agent 服务接口地址，例如 http://127.0.0.1:8000/chat'),
  apiKey: Schema.string().role('secret').description('可选：Agent 服务鉴权 key。'),
  timeout: Schema.number().default(Time.second * 20).description('请求 Agent 的超时毫秒数。'),
  triggerMode: Schema.union([
    Schema.const('mention-or-private').description('仅在 @机器人 或私聊时自动触发。'),
    Schema.const('always').description('所有消息都触发。'),
    Schema.const('private-only').description('仅私聊触发。'),
  ]).default('mention-or-private').description('自动触发条件。'),
  captureGroupContext: Schema.boolean().default(true).description('是否采集群聊中未触发自动回复的消息，用于共享上下文记忆。'),
  commandName: Schema.string().default('agent.chat').description('手动触发命令名。'),
  commandBypassSilence: Schema.boolean().default(true).description('手动命令是否绕过 Agent 的 stop 行为。'),
  passthroughMetadata: Schema.boolean().default(true).description('是否将 session 额外字段透传给 Agent。'),
})

function normalizeText(input: string) {
  return String(input || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function shouldTrigger(session: Session, config: Config) {
  const isPrivate = session.subtype === 'private' || !session.guildId
  const appel = Boolean((session as any).stripped?.appel)

  if (config.triggerMode === 'always') return true
  if (config.triggerMode === 'private-only') return isPrivate
  return isPrivate || appel
}

function isLikelyCommand(content: string) {
  return /^([/.#]|agent\.)/.test(content.trim())
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
  const isDirect = session.subtype === 'private' || !session.guildId

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
    for (const action of data.actions) {
      if (action.type === 'stop' && !bypassStop) return []
      if (action.type === 'reply') {
        const msg = normalizeText(action.content)
        if (msg) messages.push(msg)
      }
    }
    return messages
  }

  if (Array.isArray(data.segments) && data.segments.length) {
    return data.segments.map(normalizeText).filter(Boolean)
  }

  const single = normalizeText(data.reply || '')
  return single ? [single] : []
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

  let data: AgentResponseBody
  try {
    data = await callAgent(ctx, config, body)
  } catch (error) {
    logger.warn(`agent request failed: ${(error as Error).message || String(error)}`)
    return []
  }

  return responseToMessages(data, bypassStop)
}

export function apply(ctx: Context, config: Config) {
  ctx.middleware(async (session, next) => {
    if (session.type !== 'message') return next()
    if (!session.platform) return next()
    if (session.userId === session.selfId || session.author?.isBot) return next()
    const autoTriggered = shouldTrigger(session, config)
    if (!autoTriggered) {
      const isGroup = !!session.guildId && session.subtype !== 'private'
      if (config.captureGroupContext && isGroup) {
        const text = normalizeText(session.content)
        if (text && !isLikelyCommand(text)) {
          await runGateway(ctx, session, text, config, true, false, true)
        }
      }
      return next()
    }

    const text = normalizeText(session.content)
    if (!text) return next()
    if (isLikelyCommand(text)) return next()

    const messages = await runGateway(ctx, session, text, config, false, false, false)
    if (!messages.length) return next()

    for (const message of messages) {
      await session.send(message)
    }
  })

  const commandName = config.commandName?.trim() || 'agent.chat'
  ctx.command(`${commandName} <text:text>`, '手动触发 Agent 网关')
    .action(async ({ session }, text) => {
      if (!text?.trim()) return '请输入内容。'
      const messages = await runGateway(ctx, session, text, config, config.commandBypassSilence, true, false)
      if (!messages.length) return 'Agent 未返回可发送内容。'
      for (const message of messages) {
        await session.send(message)
      }
      return ''
    })
}

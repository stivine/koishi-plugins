import { Context, Logger, Schema, h } from 'koishi'

const logger = new Logger('rich-push')

export const name = 'rich-push'

export interface Config {
  defaultPlatform: string
  defaultGroupId?: string
  defaultForward: boolean
  senderNickname: string
  senderUserId: string
  commandName: string
}

export const Config: Schema<Config> = Schema.object({
  defaultPlatform: Schema.string().default('onebot').description('目标平台，默认 onebot。'),
  defaultGroupId: Schema.string().description('默认目标群号，不填则每次用 -g 指定。'),
  defaultForward: Schema.boolean().default(true).description('默认使用折叠转发消息。'),
  senderNickname: Schema.string().default('图文推送').description('折叠转发消息的显示昵称。'),
  senderUserId: Schema.string().default('0').description('折叠转发消息的显示发送者 ID。'),
  commandName: Schema.string().default('richpush').description('注册的指令名。'),
})

type Segment = { type: 'text'; value: string } | { type: 'image'; value: string }

const IMAGE_TAG_RE = /\[image\]([\s\S]*?)\[\/image\]/gi

function stripOuterBrackets(input: string) {
  const text = input.trim()
  if (text.startsWith('【') && text.endsWith('】') && text.length >= 2) {
    return text.slice(1, -1).trim()
  }
  return text
}

function parseSegments(input: string): Segment[] {
  const source = stripOuterBrackets(input)
  const segments: Segment[] = []

  let lastIndex = 0
  source.replace(IMAGE_TAG_RE, (full, url: string, offset: number) => {
    const plain = source.slice(lastIndex, offset)
    if (plain) segments.push({ type: 'text', value: plain })

    const normalizedUrl = String(url || '').trim()
    if (normalizedUrl) segments.push({ type: 'image', value: normalizedUrl })
    lastIndex = offset + full.length
    return full
  })

  const trailing = source.slice(lastIndex)
  if (trailing) segments.push({ type: 'text', value: trailing })

  if (!segments.length && source) {
    segments.push({ type: 'text', value: source })
  }
  return segments
}

function buildRichMessage(segments: Segment[]) {
  return segments.map((segment) => {
    if (segment.type === 'image') return h.image(segment.value)
    return segment.value
  }).join('')
}

function buildForwardMessage(content: string, nickname: string, userId: string) {
  const safeNickname = h.escape(nickname || '')
  const safeUserId = h.escape(userId || '0')
  return `<message forward><author id="${safeUserId}" name="${safeNickname}"/>${content}</message>`
}

export function apply(ctx: Context, config: Config) {
  const commandName = config.commandName?.trim() || 'richpush'

  ctx.command(`${commandName} <content:text>`, '把 [image]url[/image] 格式文本推送到指定群聊')
    .option('group', '-g <group:string> 指定目标群号')
    .option('platform', '-p <platform:string> 指定目标平台')
    .option('forward', '-f 使用折叠转发消息')
    .option('plain', '-P 使用普通消息（覆盖 -f）')
    .option('nickname', '-n <nickname:string> 覆盖转发显示昵称')
    .option('userId', '-u <userId:string> 覆盖转发显示发送者 ID')
    .example(`${commandName} -g 561410928 "【标题：[image]https://example.com/a.jpg[/image]】"`)
    .action(async ({ session, options }, content) => {
      if (!content?.trim()) return '请输入要发送的内容。'

      const groupId = String(options.group || config.defaultGroupId || '').trim()
      if (!groupId) return '缺少目标群号，请使用 -g 指定或在配置中设置 defaultGroupId。'

      const platform = String(options.platform || config.defaultPlatform || session.platform || '').trim()
      if (!platform) return '缺少目标平台，请使用 -p 指定或在配置中设置 defaultPlatform。'

      const nickname = String(options.nickname || config.senderNickname || '图文推送')
      const userId = String(options.userId || config.senderUserId || '0')

      const segments = parseSegments(content)
      if (!segments.length) return '内容为空，未发送。'

      const richMessage = buildRichMessage(segments)
      const useForward = options.plain ? false : (options.forward || config.defaultForward)
      const finalMessage = useForward
        ? buildForwardMessage(richMessage, nickname, userId)
        : richMessage

      const guildId = `${platform}:${groupId}`
      try {
        await ctx.broadcast([guildId], finalMessage)
      } catch (error) {
        logger.error(error)
        return `发送失败：${(error as Error).message || String(error)}`
      }

      const mode = useForward ? '折叠转发' : '普通消息'
      return `发送成功：${platform} 平台群 ${groupId}（${mode}）`
    })
}

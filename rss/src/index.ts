import { Context, Session, Logger, Time, Schema } from 'koishi'
import RssFeedEmitter from 'rss-feed-emitter'
import axios from 'axios'
import { load } from 'cheerio'

declare module 'koishi' {
  interface Channel {
    rss: string[]
  }

  interface Modules {
    rss: typeof import('.')
  }
}

const logger = new Logger('rss')

export const name = 'RSS'
export const inject = ['database'] as const

export interface Config {
  timeout?: number
  refresh?: number
  userAgent?: string
}

export const Config: Schema<Config> = Schema.object({
  timeout: Schema.number().description('请求数据的最长时间。').default(Time.second * 10),
  refresh: Schema.number().description('刷新数据的时间间隔。').default(Time.minute),
  userAgent: Schema.string().description('请求时使用的 User Agent。'),
})

const extractAdditions = (patch) => {
  const lines = patch.split('\n')
  const additions = lines
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1))
  return additions
}

export function apply(ctx: Context, config: Config) {
  ctx.model.extend('channel', {
    rss: 'list',
  })

  const { timeout, refresh, userAgent } = config
  const feedMap: Record<string, Set<string>> = {}

  // ✅ 新增：去重缓存（最小修复核心）
  const sentCache: Record<string, Set<string>> = {}

  const feeder = new RssFeedEmitter({ skipFirstLoad: true, userAgent })

  function subscribe(url: string, guildId: string) {
    if (url in feedMap) {
      feedMap[url].add(guildId)
    } else {
      feedMap[url] = new Set([guildId])
      feeder.add({ url, refresh })
      console.debug('subscribe', url)
    }
  }

  function unsubscribe(url: string, guildId: string) {
    feedMap[url].delete(guildId)
    if (!feedMap[url].size) {
      delete feedMap[url]
      feeder.remove(url)
      logger.debug('unsubscribe', url)
    }
  }

  ctx.on('dispose', () => {
    feeder.destroy()
  })

  // ✅ 只保留日志，不 destroy、不重连
  feeder.on('error', async (err: Error) => {
    console.debug(err.message)
    console.debug("测试：是这里的error")
  })

  feeder.on('new-item', async (payload) => {
    console.debug('receive')

    const source = payload.meta.link
    const itemLink = payload.link

    // ✅ 去重逻辑（防止历史重放刷屏）
    if (!sentCache[source]) {
      sentCache[source] = new Set()
    }

    if (sentCache[source].has(itemLink)) {
      console.debug('duplicate skipped:', itemLink)
      return
    }

    sentCache[source].add(itemLink)

    if (itemLink.includes('kexue.fm')) {
      var message = `苏剑林 技术博客 有新文章发布！\n${payload.title}\n${payload.link}`
      const sender_id = ""
      message = `<message forward><author id=${sender_id}/>${message}</message>`
      await ctx.broadcast([...feedMap[source]], message)
    }
    else if (itemLink.includes('lilianweng.github.io')) {
      var message = `lilian 的博客 有新文章发布！\n${payload.title}\n${payload.link}`
      const sender_id = ""
      message = `<message forward><author id=${sender_id}/>${message}</message>`
      await ctx.broadcast([...feedMap[source]], message)
    }
    else {
      console.debug(itemLink)

      var message = `新番更新！${payload.title}\n`
      const headers = {}

      try {
        const response = await axios.get(itemLink, { headers })
        const html = response.data
        const $ = load(html)

        let magnetLink = null

        $('a').each((i, el) => {
          if ($(el).text().trim() === '磁力链接') {
            magnetLink = $(el).attr('href')
            return false
          }
        })

        if (magnetLink) {
          console.log('原始磁力链接:', magnetLink)
          if (magnetLink.includes('&')) {
            magnetLink = magnetLink.split('&')[0]
          }
          message += `磁力链接: ${magnetLink}`
        } else {
          console.log('未找到磁力链接')
        }

      } catch (error) {
        console.error('请求失败:', error.message)
      }

      const sender_id = ""
      message = `<message forward><author id=${sender_id}/>${message}</message>`
      await ctx.broadcast([...feedMap[source]], message)
    }
  })

  ctx.on('ready', async () => {
    const channels = await ctx.database.getAssignedChannels(['platform', 'id', 'rss'])
    for (const channel of channels) {
      for (const url of channel.rss) {
        subscribe(url, `${channel.platform}:${channel.id}`)
      }
    }
  })

  const validators: Record<string, Promise<unknown>> = {}

  async function validate(url: string, session: Session) {
    if (validators[url]) {
      await session.send('正在尝试连接……')
      return validators[url]
    }

    let timer: NodeJS.Timeout
    const feeder = new RssFeedEmitter({ userAgent })

    return validators[url] = new Promise((resolve, reject) => {
      feeder.add({ url, refresh: 1 << 30 })
      feeder.on('new-item', resolve)
      feeder.on('error', reject)
      timer = setTimeout(() => reject(new Error('connect timeout')), timeout)
    }).finally(() => {
      feeder.destroy()
      clearTimeout(timer)
      delete validators[url]
    })
  }

  ctx.guild()
    .command('rss <url:text>', '订阅 RSS 链接')
    .channelFields(['rss', 'id', 'platform'])
    .option('list', '-l 查看订阅列表')
    .option('remove', '-r 取消订阅')
    .action(async ({ session, options }, url) => {
      const { rss, id, platform } = session.channel

      if (options.list) {
        if (!rss.length) return '未订阅任何链接。'
        return rss.join('\n')
      }

      const index = rss.indexOf(url)

      if (options.remove) {
        if (index < 0) return '未订阅此链接。'
        rss.splice(index, 1)
        unsubscribe(url, `${platform}:${id}`)
        return '取消订阅成功！'
      }

      if (index >= 0) return '已订阅此链接。test'

      return validate(url, session).then(() => {
        subscribe(url, `${platform}:${id}`)
        if (!rss.includes(url)) {
          rss.push(url)
          return '添加订阅成功！'
        }
      }, (error) => {
        logger.debug(error)
        console.error(error)
        return '无法订阅此链接。'
      })
    })
}
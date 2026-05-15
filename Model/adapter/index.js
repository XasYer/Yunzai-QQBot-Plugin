import { Dau, config } from '../index.js'
import { Bot as QQBot, Session, ReceiverMode } from 'qq-official-bot'
import Message from './message.js'
import Event from './event.js'

const userIdCache = {}

export default class QQBotAdapter {
  constructor () {
    this.id = 'QQBot'
    this.name = 'QQBot'
    this.path = 'data/QQBot/'
    this.version = 'qq-group-bot v11.45.14'

    this.sep = config.sep || ((process.platform == 'win32') && '') || ':'

    this.Message = new Message({ config, entry: this })
    this.Event = new Event({ config, entry: this })
  }

  get userCache () {
    return userIdCache
  }

  pickFriend (id, user_id) {
    if (config.toQQUin && userIdCache[user_id]) user_id = userIdCache[user_id]
    if (user_id.startsWith('qg_')) return this.pickGuildFriend(id, user_id)

    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...i,
      sendMsg: msg => this.Message.sendMsg('private', i, msg),
      recallMsg: message_id => this.Message.recallMsg('private', i, message_id),
      getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`
    }
  }

  pickMember (id, group_id, user_id) {
    if (config.toQQUin && userIdCache[user_id]) user_id = userIdCache[user_id]
    if (user_id.startsWith('qg_')) return this.pickGuildMember(id, group_id, user_id)
    const i = {
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, ''),
      group_id: group_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...this.pickFriend(id, user_id),
      ...i
    }
  }

  pickGroup (id, group_id) {
    if (group_id.startsWith?.('qg_')) { return this.pickGuild(id, group_id) }
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace?.(`${id}${this.sep}`, '') || group_id
    }
    return {
      ...i,
      sendMsg: msg => this.Message.sendMsg('group', i, msg),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
      recallMsg: message_id => this.Message.recallMsg('group', i, message_id),
      getMemberMap: () => i.bot.gml.get(group_id)
    }
  }

  pickGuildFriend (id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(/^qg_/, '')
    }
    return {
      ...i,
      sendMsg: msg => this.Message.sendMsg('direct', i, msg),
      recallMsg: (message_id, hide) => this.Message.recallMsg('direct', i, message_id, hide)
    }
  }

  pickGuildMember (id, group_id, user_id) {
    const guild_id = group_id.replace(/^qg_/, '').split('-')
    const i = {
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      src_guild_id: guild_id[0],
      src_channel_id: guild_id[1],
      user_id: user_id.replace(/^qg_/, '')
    }
    return {
      ...this.pickGuildFriend(id, user_id),
      ...i,
      sendMsg: msg => this.Message.sendMsg('direct', i, msg),
      recallMsg: (message_id, hide) => this.Message.recallMsg('direct', i, message_id, hide)
    }
  }

  pickGuild (id, group_id) {
    const guild_id = group_id.replace(/^qg_/, '').split('-')
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      guild_id: guild_id[0],
      channel_id: guild_id[1]
    }
    return {
      ...i,
      sendMsg: msg => this.Message.sendMsg('guild', i, msg),
      recallMsg: (message_id, hide) => this.Message.recallMsg('guild', i, message_id, hide),
      pickMember: user_id => this.pickGuildMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id)
    }
  }

  async setFriendMap (data) {
    if (!data.user_id) return
    await data.bot.fl.set(data.user_id, {
      ...data.bot.fl.get(data.user_id),
      ...data.sender
    })
  }

  async setGroupMap (data) {
    if (!data.group_id) return
    await data.bot.gl.set(data.group_id, {
      ...data.bot.gl.get(data.group_id),
      group_id: data.group_id
    })
    let gml = data.bot.gml.get(data.group_id)
    if (!gml) {
      gml = new Map()
      await data.bot.gml.set(data.group_id, gml)
    }
    await gml.set(data.user_id, {
      ...gml.get(data.user_id),
      ...data.sender
    })
  }

  getMap (id, type) {
    return Bot.getMap(`${this.path}${id}/${type}`)
  }

  async connect (token) {
    token = token.split(':')
    const id = token[0]
    const opts = {
      ...config.bot,
      real_self_id: id,
      appid: token[1],
      token: token[2],
      secret: token[3],
      intents: [
        'GUILDS',
        'GUILD_MEMBERS',
        'GUILD_MESSAGE_REACTIONS',
        'DIRECT_MESSAGE',
        'INTERACTION',
        'MESSAGE_AUDIT'
      ],
      mode: ReceiverMode.WEBSOCKET
    }

    if (Number(token[4])) opts.intents.push('GROUP_AND_C2C_EVENT')
    if (Number(token[5])) opts.intents.push('GUILD_MESSAGES')
    else opts.intents.push('PUBLIC_GUILD_MESSAGES')

    const sdk = new QQBot(opts)
    const bus = config.bus
    if (bus?.[id]) {
      let keys = Object.keys(bus)
      const { sandbox, appid } = opts
      const base = `https://${bus[id]}/proxy?url=https://${sandbox ? 'sandbox.' : ''}api.sgroup.qq.com`
      sdk.request.defaults.baseURL = base

      Object.assign(Session.prototype, {
        getWsUrl: async function () {
          const url = await this.authManager.getGatewayUrl()
          this._wsUrl = keys.some(i => i == this.bot.config.real_self_id) ? `wss://${bus[id]}/ws?url=${url}&appid=${appid}` : url
          logger.info(`WebSocket URL 已更新: ${this._wsUrl}`)
          return this._wsUrl
          // return new Promise((resolve) => {
          //   this.bot.request.get('/gateway/bot', {
          //     headers: {
          //       Accept: '*/*',
          //       'Accept-Encoding': 'utf-8',
          //       'Accept-Language': 'zh-CN,zh;q=0.8',
          //       Connection: 'keep-alive',
          //       'User-Agent': 'v1',
          //       Authorization: `QQBot ${token}`
          //     }
          //   }).then((res) => {
          //     if (!res.data) throw new Error('获取ws连接信息异常')
          //     this.wsUrl = keys.some(i => i == this.bot.config.real_self_id) ? `wss://${config.bus[id]}/ws?url=${res.data.url}&appid=${appid}` : res.data.url
          //     logger.info(`WebSocket URL 已更新: ${this.wsUrl}`)
          //     resolve(this.wsUrl)
          //   })
          // })
        }
      })
    }

    Bot[id] = {
      adapter: this,
      sdk,
      login () {
        return new Promise(resolve => {
          this.sdk.receiver.once('ready', resolve)
          this.sdk.start()
        })
      },
      logout () {
        return new Promise(resolve => {
          this.sdk.receiver.once('close', resolve)
          this.sdk.stop()
        })
      },

      uin: id,
      info: { id, ...opts },
      get nickname () { return this.sdk.nickname },
      get avatar () { return `https://q.qlogo.cn/g?b=qq&s=0&nk=${id}` },

      version: {
        id: this.id,
        name: this.name,
        version: this.version
      },
      stat: {
        start_time: Date.now() / 1000,
        recv_msg_cnt: 0
      },

      pickFriend: user_id => this.pickFriend(id, user_id),
      get pickUser () { return this.pickFriend },
      getFriendMap () { return this.fl },
      fl: await this.getMap(id, 'Friend'),

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap () { return this.gl },
      gl: await this.getMap(id, 'Group'),
      gml: await this.getMap(id, 'Member'),

      dau: new Dau(id, this.sep, config.dauDB),

      callback: {}
    }

    Bot[id].sdk.logger = {}
    for (const i of ['trace', 'debug', 'info', 'mark', 'warn', 'error', 'fatal']) {
      Bot[id].sdk.logger[i] = (...args) => {
        if (config.simplifiedSdkLog) {
          if (args?.[0]?.match?.(/^send to/)) {
            args[0] = args[0].replace(/<(.+?)(,.*?)>/g, (v, k1, k2) => {
              return `<${k1}>`
            })
          } else if (args?.[0]?.match?.(/^recv from/)) {
            return
          }
        }
        Bot.makeLog(i, args, id)
      }
    }

    await Bot[id].login()
    Object.assign(Bot[id].info, await Bot[id].sdk.getSelfInfo())

    await Bot[id].dau.init()

    Bot[id].sdk.on('message', event => this.Event.Message(id, event))
    Bot[id].sdk.on('notice', event => this.Event.Notice(id, event))

    Bot.makeLog('mark', `${this.name}(${this.id}) ${this.version} 已连接`, id)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async load () {
    for (const token of config.token) {
      await new Promise(resolve => {
        this.connect(token).then(resolve)
        setTimeout(resolve, 5000)
      })
    }
  }
}

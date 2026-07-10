import _ from 'lodash'
import base from './base.js'
import { importJS, Handler } from '../index.js'

/** 接收消息 */
export default class Event extends base {
  constructor ({ config, entry }) {
    super({ config, entry })
    this.sender = this.entry.sender || {}
  }

  async Message (id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
      get user_id () { return this.sender?.user_id || event.user_id },
      message: [],
      raw_message: event.raw_message
    }
    // @消息处理
    if (event.mentions) {
      data.mentions = {}

      event.mentions.forEach(at => {
        const qq = `${data.message_type === 'group' ? data.self_id + this.sep : 'qg_'}${at.id}`

        data.message.push({ type: 'at', qq })
        data.mentions[qq] = at
      })
    }
    if (event.message) {
      event.message.forEach(i => {
        data.message.push({ ...i.data, type: i.type })
      })
    }

    if (['private', 'direct', 'group', 'guild'].includes(data.message_type)) {
      let type = data.message_type

      const btype = this.baseType[type]
      data.sender = {
        ...event.author,
        user_id: `${data.self_id}${this.sep}${event.user_id}`,
        nickname: event.author.username
      }

      // 自定义消息过滤前台日志防刷屏(自欺欺人大法)
      const filterLog = this.cfg.filterLog?.[data.self_id] || []
      const logStat = filterLog.includes(_.trim(data.raw_message)) ? 'debug' : 'info'

      let logPrefix = ''
      await this[`${type}RM`](data, event, btype, logPrefix)
      Bot.makeLog(logStat, `${logPrefix} ${data.raw_message}`, data.self_id)

      data.reply = msg => this.entry.Message.sendMsg(type, data, msg, { id: data.message_id })

      if (['private', 'direct', 'guild'].includes(type)) await this.entry.setFriendMap(data)
      if (['group', 'guild'].includes(type)) await this.entry.setGroupMap(data)
      if (type === 'guild' && !data.message.length) data.message.push({ type: 'text', text: '' })
    } else if (data.message_type.includes('audi')) {
      let status = data.sub_type
      const logStat = status === 'pass' ? 'debug' : 'warn'
      status = status === 'pass' ? '通过' : '拒绝'

      Bot.makeLog(logStat, `消息审核${status} ${data.post_type}.${data.message_type}.${data.sub_type}`, data.self_id)
      return
    } else {
      Bot.makeLog('warn', ['未知消息', event], id)
      return
    }

    data.bot.stat.recv_msg_cnt++
    Bot[data.self_id].dau.setDau('receive_msg', data)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async Notice (id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      notice_type: event.notice_type,
      sub_type: event.sub_type,
      notice_id: event.notice_id,
      group_id: event.group_id,
      user_id: event.user_id || event.operator_id
    }

    switch (data.sub_type) {
      case 'action':
        return this.CallBack(id, event)
      case 'increase':
        Bot[data.self_id].dau.setDau('group_increase', data)
        if (event.notice_type === 'group') {
          const groupIncreaseMsg = importJS('Model/template/groupIncreaseMsg.js', 'default')
          if (groupIncreaseMsg) {
            groupIncreaseMsg.then(async i => {
              let msg = i
              if (typeof i === 'function') msg = await i(`${data.self_id}${this.sep}${event.group_id}`, `${data.self_id}${this.sep}${data.user_id}`, data.self_id)
              if (msg?.length) this.entry.Message.sendMsg('group', data, msg)
            })
          }
        }
        return
      case 'decrease':
        Bot[data.self_id].dau.setDau('group_decrease', data)
      case 'member.increase':
      case 'member.decrease':
        data.sub_type = data.sub_type.split('.').pop()
        Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
      case 'update':
      case 'member.update':
      case 'add':
      case 'remove':
        break
      case 'receive_open':
      case 'receive_close':
        Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
        break
      default:
        // console.log('event', event)
        Bot.makeLog('warn', ['未知通知', event], id)
    }

    // Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
  }

  async CallBack (id, event) {
    const reply = event.reply.bind(event)
    event.reply = async (...args) => {
      try {
        return await reply(...args)
      } catch (err) {
        Bot.makeLog('debug', ['回复按钮点击事件错误', err], data.self_id)
      }
    }

    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: 'message',
      message_id: event.notice_id,
      message_type: event.notice_type,
      sub_type: 'callback',
      get user_id () { return this.sender?.user_id || event.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: ''
    }

    const btn = event.data?.resolved
    const callback = data.bot.callback[btn?.button_id]

    if (callback) {
      if (!event.group_id && callback.group_id) event.group_id = callback.group_id
      data.message_id = callback.id

      if (callback.message_id.length) {
        for (const id of callback.message_id) {
          data.message.push({ type: 'reply', id })
        }
        data.raw_message += `[回复：${callback.message_id}]`
      }
      addMsg('text', callback.message)
    } else {
      if (btn?.button_id) addMsg('reply', btn.button_id)
      if (btn?.button_data) addMsg('text', btn.button_data)
      else event.reply(1)
    }

    function addMsg (type, msg) {
      const obj = { type }
      if (type === 'text') obj.text = msg
      else if (type === 'reply') obj.id = msg

      data.message.push(obj)
      data.raw_message += type === 'text' ? msg : `[回复：${msg}]`
    }
  }

  async receive (data, event, type) {
  }

  privateRM (data, event, btype, logPrefix) {
    data = { ...data, user_id: event.sender.user_id }
    logPrefix = `${btype.name}消息：[${data[btype.id]}]`
  }

  async groupRM (data, event, btype, logPrefix) {
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    await this.#wsFindUser(data)

    data = { ...data, group_id: event.group_id }
    logPrefix = `${btype.name}消息：[${data[btype.id]}, ${data.user_id}]`
  }

  directRM (data, event, btype, logPrefix) {
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      avatar: event.author.avatar,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
      src_guild_id: event.src_guild_id
    }

    data = {
      ...data,
      user_id: event.user_id,
      guild_id: event.guild_id,
      channel_id: event.channel_id
    }
    logPrefix = `${btype.name}消息：[${data.sender.nickname}(${data.user_id})]`
  }

  async guildRM (data, event, btype, logPrefix) {
    data.message_type = 'group'
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      card: event.member.nick,
      avatar: event.author.avatar,
      src_guild_id: event.guild_id,
      src_channel_id: event.channel_id,
      group_id: `qg_${event.guild_id}-${event.channel_id}`
    }
    await this.#wsFindUser(data)

    data = { ...data, guild_id: event.guild_id, channel_id: event.channel_id }
    logPrefix = `${btype.name}消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})]`
  }

  async #wsFindUser (data) {
    if (this.cfg.toQQUin && Handler.has('ws.tool.findUserId')) {
      const user_id = await Handler.call('ws.tool.findUserId', { user_id: data.user_id })
      if (user_id?.custom) {
        this.userCache[user_id.custom] = data.user_id
        data.sender.user_id = user_id.custom
      }
    }
  }
}

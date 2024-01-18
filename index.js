logger.info(logger.yellow('- 正在加载 QQBot 适配器插件'))

import { config, configSave } from './Model/config.js'
import fs from 'node:fs'
import path, { join } from 'node:path'
import QRCode from 'qrcode'
import moment from 'moment'
import imageSize from 'image-size'
import schedule from 'node-schedule'
import { randomUUID } from 'node:crypto'
import { encode as encodeSilk } from 'silk-wasm'
import { Bot as QQBot } from 'qq-group-bot'
import Runtime from '../../lib/plugins/runtime.js'
import Handler from '../../lib/plugins/handler.js'
import puppeteer from '../../lib/puppeteer/puppeteer.js'
import _ from 'lodash'

const userIdCache = {}
const DAU = {}
let findUser_id
setTimeout(async () => {
  findUser_id = await (async () => {
    try {
      return (await import('../ws-plugin/model/db/index.js')).findUser_id
    } catch (error) {
      return false
    }
  })()
}, 5000)

const adapter = new class QQBotAdapter {
  constructor() {
    this.id = 'QQBot'
    this.name = 'QQBot'
    this.path = 'data/QQBot/'
    this.version = `qq-group-bot ${config.package.dependencies['qq-group-bot'].replace('^', 'v')}`

    if (typeof config.toQRCode == 'boolean')
      this.toQRCodeRegExp = config.toQRCode ? /https?:\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])?/g : false
    else
      this.toQRCodeRegExp = new RegExp(config.toQRCode, 'g')

    this.sep = ':'
    if (process.platform == 'win32') this.sep = config.sep || ''
  }

  async makeSilk(file) {
    const inputFile = path.join('temp', randomUUID())
    const pcmFile = path.join('temp', randomUUID())

    try {
      fs.writeFileSync(inputFile, await Bot.Buffer(file))
      await Bot.exec(`ffmpeg -i "${inputFile}" -f s16le -ar 48000 -ac 1 "${pcmFile}"`)
      file = Buffer.from((await encodeSilk(fs.readFileSync(pcmFile), 48000)).data)
    } catch (err) {
      logger.error(`silk 转码错误：${err}`)
    }

    for (const i of [inputFile, pcmFile])
      try { fs.unlinkSync(i) } catch (err) { }

    return file
  }

  async makeQRCode(data) {
    return (await QRCode.toDataURL(data)).replace('data:image/png;base64,', 'base64://')
  }

  async makeRawMarkdownText(data, button) {
    const match = data.match(this.toQRCodeRegExp)
    if (match) for (const url of match) {
      button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
      const img = await this.makeImage(await this.makeQRCode(url))
      data = data.replace(url, `![${img.dec}](${img.url})`)
    }
    return data
  }

  async makeImage(file) {
    const buffer = await Bot.Buffer(file)
    if (!Buffer.isBuffer(buffer)) return {}

    let url
    if (config.toMd) {
      url = await Bot.fileToUrl(buffer)
    } else
      if (file.match?.(/^https?:\/\//)) url = file
      else url = await Bot.fileToUrl(buffer)

    const size = imageSize(buffer)
    return { dec: `图片 #${size.width}px #${size.height}px`, url }
  }

  makeButton(data, button) {
    const msg = {
      id: randomUUID(),
      render_data: {
        label: button.text,
        visited_label: button.clicked_text,
        style: typeof button.style === 'number' ? button.style : 1,
        ...button.QQBot?.render_data
      }
    }

    if (button.input)
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.input,
        enter: button.send,
        ...button.QQBot?.action
      }
    else if (button.callback) {
      if (config.toCallback) {
        msg.action = {
          type: 1,
          permission: { type: 2 },
          ...button.QQBot?.action,
        }
        if (!Array.isArray(data._ret_id))
          data._ret_id = []
        data.bot.callback[msg.id] = {
          id: data.message_id,
          user_id: data.user_id,
          group_id: data.group_id,
          message: button.callback,
          message_id: data._ret_id,
        }
        setTimeout(() => delete data.bot.callback[msg.id], 300000)
      } else {
        msg.action = {
          type: 2,
          permission: { type: 2 },
          data: button.callback,
          enter: true,
          ...button.QQBot?.action,
        }
      }
    } else if (button.link)
      msg.action = {
        type: 0,
        permission: { type: 2 },
        data: button.link,
        ...button.QQBot?.action
      }
    else return false

    if (button.permission) {
      if (button.permission == 'admin') {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission))
          button.permission = [button.permission]
        for (const id of button.permission)
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this.sep}`, ''))
      }
    }
    return msg
  }

  makeButtons(data, button_square) {
    const msgs = []
    for (const button_row of button_square) {
      const buttons = []
      for (let button of button_row) {
        button = this.makeButton(data, button)
        if (button) buttons.push(button)
      }
      if (buttons.length)
        msgs.push({ type: 'button', buttons })
    }
    return msgs
  }


  async makeRawMarkdownMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let content = ''
    const button = []
    let reply

    for (let i of msg) {
      if (typeof i == 'object')
        i = { ...i }
      else
        i = { type: 'text', text: i }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.file = await this.makeSilk(i.file)
        case 'video':
          if (i.file) i.file = await Bot.fileToUrl(i.file, {}, i.type)
          messages.push(i)
          break
        case 'file':
          if (i.file) i.file = await Bot.fileToUrl(i.file, i, type)
          content += await this.makeRawMarkdownText(`文件：${i.file}`, button)
          break
        case 'at':
          if (i.qq == 'all')
            content += '@everyone'
          else
            content += `<@${i.qq.replace(`${data.self_id}${this.sep}`, '')}>`
          break
        case 'text':
          content += await this.makeRawMarkdownText(i.text, button)
          break
        case 'image': {
          const { dec, url } = await this.makeImage(i.file)
          content += `![${dec}](${url})`
          break
        } case 'markdown':
          content += i.data
          break
        case 'button':
          button.push(...this.makeButtons(data, i.data))
          break
        case 'face':
          break
        case 'reply':
          reply = i
          continue
        case 'node':
          for (const { message } of i.data)
            messages.push(...(await this.makeRawMarkdownMsg(data, message)))
          continue
        case 'raw':
          messages.push(i.data)
          break
        default:
          content += await this.makeRawMarkdownText(JSON.stringify(i), button)
      }
    }

    if (content) messages.unshift([
      { type: "markdown", content },
      ...button.splice(0, 5),
    ])

    while (button.length) {
      messages.push([
        { type: "markdown", content: " " },
        ...button.splice(0, 5),
      ])
    }

    if (reply) for (const i in messages) {
      if (Array.isArray(messages[i]))
        messages[i].unshift(reply)
      else
        messages[i] = [reply, messages[i]]
    }
    return messages
  }

  makeMarkdownTemplate(data, template) {
    const params = []
    for (const i of ['text_start', 'img_dec', 'img_url', 'text_end'])
      if (template[i]) params.push({ key: i, values: [template[i]] })
    return {
      type: 'markdown',
      custom_template_id: config.markdown[data.self_id],
      params
    }
  }

  async makeMarkdownMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let content = ''
    let button = []
    let template = {}
    let reply
    let raw = []

    for (let i of msg) {
      if (typeof i == 'object')
        i = { ...i }
      else
        i = { type: 'text', text: i }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.file = await this.makeSilk(i.file)
        case 'video':
          if (i.file) i.file = await Bot.fileToUrl(i.file, {}, i.type)
          messages.push(i)
          break
        case 'file':
          if (i.file) i.file = await Bot.fileToUrl(i.file, i, i.type)
          button.push(...this.makeButtons(data, [[{ text: i.name || i.file, link: i.file }]]))
          content += '[文件(请点击按钮查看)]'
          break
        case 'at':
          if (i.qq == 'all') {
            content += '@everyone'
          } else {
            if (config.toQQUin && userIdCache[i.qq]) {
              i.qq = userIdCache[i.qq]
            }
            content += `<@${i.qq.replace(`${data.self_id}${this.sep}`, '')}>`
          }
          break
        case 'text':
          content += i.text
          break
        case 'node':
          if (Handler.has('ws.tool.toImg')) {
            function getButton(data) {
              return data.flatMap(item => {
                if (Array.isArray(item.message)) {
                  return item.message.flatMap(msg => {
                    if (msg.type === 'node') return getButton(msg.data)
                    if (msg.type === 'button') return msg
                    return []
                  })
                }
                if (typeof item.message === 'object') {
                  if (item.message.type === 'button') return item.message
                  if (item.message.type === 'node') return getButton(item.message.data)
                }
                return []
              })
            }
            const btn = getButton(i.data)
            const result = btn.reduce((acc, cur) => {
              const duplicate = acc.find(obj => obj.text === cur.text && obj.callback === cur.callback && obj.input === cur.input && obj.link === cur.link)
              if (!duplicate) {
                return acc.concat([cur])
              } else {
                return acc
              }
            }, [])
            for (const b of result) {
              button.push(...this.makeButtons(data, b.data))
            }
            const e = {
              reply: (msg) => {
                i = msg
              },
              // 兼容一下
              bot: {},
              user_id: data.bot.uin,
              nickname: data.bot.nickname
            }
            e.runtime = new Runtime(e)
            await Handler.call('ws.tool.toImg', e, i.data)
          } else {
            for (const { message } of i.data)
              messages.push(...(await this.makeMarkdownMsg(data, message)))
            continue
          }
        case 'image': {
          const { dec, url } = await this.makeImage(i.file)

          if (template.img_dec && template.img_url) {
            template.text_end = content
            messages.push(this.makeMarkdownTemplate(data, template))
            content = ''
            button = []
          }

          template = {
            text_start: content,
            img_dec: dec,
            img_url: url
          }
          content = ''
          break
        } case 'markdown':
          if (typeof i.data == 'object')
            messages.push({ type: 'markdown', ...i.data })
          else
            messages.push({ type: 'markdown', content: i.data })
          break
        case 'button':
          button.push(...this.makeButtons(data, i.data))
          break
        case 'face':
          break
        case 'reply':
          reply = i
          continue
        case 'raw':
          // messages.push(i.data)
          raw.push(i.data)
          break
        default:
          content += JSON.stringify(i)
      }

      if (content) {
        content = content.replace(/\n/g, '\r')
        const match = content.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
          content = content.replace(url, '[链接(请点击按钮查看)]')
        }
      }
    }
    if (raw.length) {
      messages.push(raw)
    }
    if (template.img_dec && template.img_url)
      template.text_end = content
    else if (content)
      template = { text_start: content }

    if (template.text_start || template.text_end || (template.img_dec && template.img_url))
      messages.push(this.makeMarkdownTemplate(data, template))

    for (const i in messages)
      if (!Array.isArray(messages[i]))
        messages[i] = [messages[i]]

    if (button.length) {
      for (const i of messages) {
        if (i[0].type == "markdown")
          i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          this.makeMarkdownTemplate(data, { text_start: " " }),
          ...button.splice(0, 5),
        ])
      }
    }
    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  async makeMsg(data, msg) {
    const sendType = ['audio', 'image', 'video', 'file']
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let message = []
    let reply
    for (let i of msg) {
      if (typeof i == 'object')
        i = { ...i }
      else
        i = { type: 'text', text: i }

      switch (i.type) {
        case 'at':
          // if (config.toQQUin && userIdCache[user_id]) {
          //   i.qq = userIdCache[user_id]
          // }
          //i.qq = i.qq.replace(`${data.self_id}${this.sep}`, "")
          continue
        case 'text':
        case 'face':
        case 'ark':
        case 'embed':
          break
        case 'record':
          i.type = 'audio'
          i.file = await this.makeSilk(i.file)
        case 'image':
        case 'video':
          if (i.file) i.file = await Bot.fileToUrl(i.file, {}, i.type)
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
          }
          break
        case 'file':
          if (i.file) i.file = await Bot.fileToUrl(i.file, i, i.type)
          i = { type: 'text', text: `文件：${i.file}` }
          break
        case 'reply':
          reply = i
          continue
        case 'markdown':
          if (typeof i.data == 'object')
            i = { type: 'markdown', ...i.data }
          else
            i = { type: 'markdown', content: i.data }
          break
        case 'button':
          message.push(...this.makeButtons(data, i.data))
          continue
        case 'node':
          if (Handler.has('ws.tool.toImg')) {
            const e = {
              reply: (msg) => {
                i = msg
              },
              // 兼容一下
              bot: {},
              user_id: data.bot.uin,
              nickname: data.bot.nickname
            }
            e.runtime = new Runtime(e)
            await Handler.call('ws.tool.toImg', e, i.data)
            i.file = await Bot.fileToUrl(i.file)
            if (message.some(s => sendType.includes(s.type))) {
              messages.push(message)
              message = []
            }
          } else {
            for (const { message } of i.data)
              messages.push(...(await this.makeMsg(data, message)))
          }
          break
        case 'raw':
          i = i.data
          break
        default:
          i = { type: 'text', text: JSON.stringify(i) }
      }

      if (i.type == 'text' && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          const msg = segment.image(await Bot.fileToUrl(await this.makeQRCode(url)))
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
          }
          message.push(msg)
          i.text = i.text.replace(url, '[链接(请扫码查看)]')
        }
      }

      message.push(i)
    }
    if (message.length)
      messages.push(message)
    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  async sendMsg(data, send, msg) {
    const rets = { message_id: [], data: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) try {
        Bot.makeLog('debug', ['发送消息', i], data.self_id)
        const ret = await send(i)
        Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

        rets.data.push(ret)
        if (ret.msg_id)
          rets.message_id.push(ret.msg_id)
        DAU[this.uin].send_count++
        const time = moment(Date.now()).add(1, 'days').format('YYYY-MM-DD 00:00:00')
        const EX = Math.round(
          (new Date(time).getTime() - new Date().getTime()) / 1000
        )
        redis.set(`QQBotDAU:send_count:${this.uin}`, DAU[this.uin].send_count * 1, { EX })
      } catch (err) {
        if (err.response?.data) {
          const trace_id = err.response.headers?.['x-tps-trace-id'] || err.trace_id
          err = { ...err.response.data, trace_id }
        }
        Bot.makeLog('error', [`发送消息错误：${Bot.String(msg)}\n`, err], data.self_id)
        return false
      }
    }

    if (config.markdown[data.self_id] && !['guild', 'direct'].includes(data?.raw?.message_type)) {
      if (config.markdown[data.self_id] == 'raw')
        msgs = await this.makeRawMarkdownMsg(data, msg)
      else
        msgs = await this.makeMarkdownMsg(data, msg)
    } else {
      msgs = await this.makeMsg(data, msg)
    }

    if (await sendMsg() === false) {
      msgs = await this.makeMsg(data, msg)
      await sendMsg()
    }

    if (Array.isArray(data._ret_id))
      data._ret_id.push(...rets.message_id)
    return rets
  }

  sendFriendMsg(data, msg, event) {
    if (['guild', 'direct'].includes(data.message_type)) {
      Bot.makeLog('info', `发送频道私聊消息：[${data.user_id}] ${Bot.String(msg)}`, data.self_id)
      return this.sendMsg(data, msg => data.bot.sdk.sendDirectMessage(data.user_id, msg, event), msg)
    }
    Bot.makeLog('info', `发送好友消息：[${data.user_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendPrivateMessage(data.user_id, msg, event), msg)
  }

  sendGroupMsg(data, msg, event) {
    if (data.message_type === 'guild') {
      Bot.makeLog('info', `发送频道消息：[${data.group_id}] ${Bot.String(msg)}`, data.self_id)
      return this.sendMsg(data, msg => data.bot.sdk.sendGuildMessage(data.group_id, msg, event), msg)
    }
    Bot.makeLog('info', `发送群消息：[${data.group_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(data.group_id, msg, event), msg)
  }

  pickFriend(id, user_id) {
    if (config.toQQUin && userIdCache[user_id]) {
      user_id = userIdCache[user_id]
    }
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      sendFile: (file, name) => this.sendFriendMsg(i, segment.file(file, name))
    }
  }

  pickMember(id, group_id, user_id) {
    if (config.toQQUin && userIdCache[user_id]) {
      user_id = userIdCache[user_id]
    }
    const i = {
      ...Bot[id].fl.get(user_id),
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

  pickGroup(id, group_id) {
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      sendFile: (file, name) => this.sendGroupMsg(i, segment.file(file, name)),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id),
    }
  }

  async makeMessage(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      message_id: event.message_id,
      get user_id() { return this.sender.user_id },
      sender: event.sender,
      message: event.message,
      raw_message: event.raw_message
    }

    switch (data.message_type) {
      case "private":
        data.sender.user_id = `${id}${this.sep}${event.user_id}`
        Bot.makeLog("info", `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.user_id }, msg, { id: data.message_id })
        break
      case "group":
        data.sender.user_id = `${id}${this.sep}${event.user_id}`
        data.group_id = `${id}${this.sep}${event.group_id}`
        if (config.toQQUin && typeof findUser_id === 'function') {
          const user_id = await findUser_id({ user_id: data.user_id })
          if (user_id?.custom) {
            userIdCache[user_id.custom] = data.user_id
            data.sender.user_id = user_id.custom
          }
        }
        Bot.makeLog("info", `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
        break
      case "direct":
        if (!config.guild) return
        // 为什么是guild_id
        data.sender.user_id = `${id}${this.sep}${event.guild_id}`
        data.message_type = 'private'
        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.guild_id, message_type: 'direct' }, msg, { id: data.message_id })
        // if (config.toQQUin && typeof findUser_id === 'function') {
        //   const user_id = await findUser_id({ user_id: data.user_id })
        //   if (user_id?.custom) {
        //     userIdCache[user_id.custom] = data.user_id
        //     data.sender.user_id = user_id.custom
        //   }
        // }
        Bot.makeLog('info', `频道私聊消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
        break
      case "guild":
        if (!config.guild) return
        data.sender.user_id = `${id}${this.sep}${event.user_id}`
        data.group_id = `${id}${this.sep}${event.channel_id}`
        data.message_type = 'group'
        if (data.message.length === 0) {
          // tx.sb 群有一个空格频道没有
          data.message.push({ type: 'text', text: '' })
        }
        if (config.toQQUin && typeof findUser_id === 'function') {
          const user_id = await findUser_id({ user_id: data.user_id })
          if (user_id?.custom) {
            userIdCache[user_id.custom] = data.user_id
            data.sender.user_id = user_id.custom
          }
        }
        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.channel_id, message_type: 'guild' }, msg, { id: data.message_id })
        Bot.makeLog('info', `频道消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
        break
      default:
        Bot.makeLog("warn", ["未知消息", event], id)
        return
    }

    data.bot.fl.set(data.user_id, { ...data.sender, type: event.message_type })
    if (data.group_id) {
      data.bot.gl.set(data.group_id, {
        group_id: data.group_id,
      })
      let gml = data.bot.gml.get(data.group_id)
      if (!gml) {
        gml = new Map
        data.bot.gml.set(data.group_id, gml)
      }
      gml.set(data.user_id, data.sender)
    }

    data.bot.stat.recv_msg_cnt++
    let needSetRedis = false
    DAU[this.uin].msg_count++
    if (data.group_id && !DAU[this.uin].group_cache[data.group_id]) {
      DAU[this.uin].group_cache[data.group_id] = 1
      DAU[this.uin].group_count++
      needSetRedis = true
    }
    if (data.user_id && !DAU[this.uin].user_cache[data.user_id]) {
      DAU[this.uin].user_cache[data.user_id] = 1
      DAU[this.uin].user_count++
      needSetRedis = true
    }
    const time = moment(Date.now()).add(1, 'days').format('YYYY-MM-DD 00:00:00')
    const EX = Math.round(
      (new Date(time).getTime() - new Date().getTime()) / 1000
    )
    if (needSetRedis) redis.set(`QQBotDAU:${this.uin}`, JSON.stringify(DAU[this.uin]), { EX })
    redis.set(`QQBotDAU:msg_count:${this.uin}`, DAU[this.uin].msg_count * 1, { EX })
    Bot.em(`${data.post_type}.${data.message_type}`, data)
  }

  makeCallback(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: "message",
      message_id: event.notice_id,
      message_type: event.notice_type,
      get user_id() { return this.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: "",
    }

    const callback = data.bot.callback[event.data?.resolved?.button_id]
    if (callback) {
      if (!event.group_id && callback.group_id)
        event.group_id = callback.group_id
      data.message_id = callback.id
      if (callback.message_id.length) {
        for (const id of callback.message_id)
          data.message.push({ type: "reply", id })
        data.raw_message += `[回复：${callback.message_id}]`
      }
      data.message.push({ type: "text", text: callback.message })
      data.raw_message += callback.message
    } else {
      if (event.data?.resolved?.button_id) {
        data.message.push({ type: "reply", id: event.data?.resolved?.button_id })
        data.raw_message += `[回复：${event.data?.resolved?.button_id}]`
      }
      if (event.data?.resolved?.button_data) {
        data.message.push({ type: "text", text: event.data?.resolved?.button_data })
        data.raw_message += event.data?.resolved?.button_data
      } else {
        event.reply(1)
      }
    }
    event.reply(0)

    switch (data.message_type) {
      case "friend":
        Bot.makeLog("info", [`好友按钮点击事件：[${data.user_id}]`, data.raw_message], data.self_id)
        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.operator_id }, msg, { id: data.message_id })
        break
      case "group":
        data.group_id = `${id}${this.sep}${event.group_id}`
        Bot.makeLog("info", [`群按钮点击事件：[${data.group_id}, ${data.user_id}]`, data.raw_message], data.self_id)
        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
        break
      case "direct":
      case "guild":
        break
      default:
        Bot.makeLog("warn", ["未知按钮点击事件", event], data.self_id)
    }

    Bot.em(`${data.post_type}.${data.message_type}`, data)
  }

  makeNotice(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      notice_type: event.notice_type,
      sub_type: event.sub_type,
      notice_id: event.notice_id,
    }

    switch (data.sub_type) {
      case "action":
        return this.makeCallback(id, event)
      case "increase":
      case "decrease":
      case "update":
      case "member.increase":
      case "member.decrease":
      case "member.update":
        break
      default:
        Bot.makeLog("warn", ["未知通知", event], id)
        return
    }

    //Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
  }

  getFriendMap(id) {
    return Bot.getMap(`${this.path}${id}/Friend`)
  }

  getGroupMap(id) {
    return Bot.getMap(`${this.path}${id}/Group`)
  }

  getMemberMap(id) {
    return Bot.getMap(`${this.path}${id}/Member`)
  }

  async connect(token) {
    token = token.split(':')
    const id = token[0]
    const opts = {
      ...config.bot,
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
    }

    if (Number(token[4]))
      opts.intents.push('GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE')

    if (Number(token[5]))
      opts.intents.push('GUILD_MESSAGES')
    else
      opts.intents.push('PUBLIC_GUILD_MESSAGES')

    Bot[id] = {
      adapter: this,
      sdk: new QQBot(opts),
      login() { return this.sdk.start() },

      uin: id,
      info: { id },
      get nickname() { return this.sdk.nickname },
      get avatar() { return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${this.uin}` },

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
      get pickUser() { return this.pickFriend },
      getFriendMap() { return this.fl },
      fl: this.getFriendMap(id),

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap() { return this.gl },
      gl: this.getGroupMap(id),
      gml: this.getMemberMap(id)
    }

    await Bot[id].login()

    Bot[id].sdk.logger = {}
    for (const i of ['trace', 'debug', 'info', 'mark', 'warn', 'error', 'fatal'])
      Bot[id].sdk.logger[i] = (...args) => Bot.makeLog(i, args, id)

    Bot[id].sdk.on("message", event => this.makeMessage(id, event))
    Bot[id].sdk.on("notice", event => this.makeNotice(id, event))

    logger.mark(`${logger.blue(`[${id}]`)} ${this.name}(${this.id}) ${this.version} 已连接`)
    Bot.em(`connect.${id}`, { self_id: id })
    this.uin = id
    DAU[id] = await getDAU(id)
    return true
  }

  async load() {
    for (const token of config.token)
      await new Promise(resolve => {
        adapter.connect(token).then(resolve)
        setTimeout(resolve, 5000)
      })
  }
}

Bot.adapter.push(adapter)

export class QQBotAdapter extends plugin {
  constructor() {
    super({
      name: 'QQBotAdapter',
      dsc: 'QQBot 适配器设置',
      event: 'message',
      rule: [
        {
          reg: '^#[Qq]+[Bb]ot账号$',
          fnc: 'List',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot设置[0-9]+:[0-9]+:.+:.+:[01]:[01]$',
          fnc: 'Token',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?[0-9]+:',
          fnc: 'Markdown',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot设置转换\\s*(开启|关闭)$',
          fnc: 'Setting',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot设置频道\\s*(开启|关闭)$',
          fnc: 'Guild',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot[Dd][Aa][Uu]',
          fnc: 'DAUStat',
          permission: config.permission
        }
      ]
    })
  }

  List() {
    this.reply(`共${config.token.length}个账号：\n${config.token.join('\n')}`, true)
  }

  async Token() {
    const token = this.e.msg.replace(/^#[Qq]+[Bb]ot设置/, '').trim()
    if (config.token.includes(token)) {
      config.token = config.token.filter(item => item != token)
      this.reply(`账号已删除，重启后生效，共${config.token.length}个账号`, true)
    } else {
      if (await adapter.connect(token)) {
        config.token.push(token)
        this.reply(`账号已连接，共${config.token.length}个账号`, true)
      } else {
        this.reply('账号连接失败', true)
        return false
      }
    }
    configSave(config)
  }

  Markdown() {
    let token = this.e.msg.replace(/^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?/, '').trim().split(':')
    const bot_id = token.shift()
    token = token.join(':')
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    configSave(config)
  }

  async Setting() {
    const toQQUin = !!this.e.msg.includes('开启')
    config.toQQUin = toQQUin
    this.reply('设置成功,已' + (toQQUin ? '开启' : '关闭'), true)
    configSave(config)
  }

  async Guild() {
    const guild = !!this.e.msg.includes('开启')
    config.guild = guild
    this.reply('设置成功,已' + (guild ? '开启' : '关闭'), true)
    configSave(config)
  }

  async DAUStat() {
    const pro = !!/^#[Qq]+[Bb]ot[Dd][Aa][Uu]([Pp]ro)?/.exec(this.e.msg)[1]
    const uin = this.e.msg.replace(/^#[Qq]+[Bb]ot[Dd][Aa][Uu]([Pp]ro)?/, '') || this.e.self_id
    const dau = DAU[uin]
    if (!dau) return false
    const msg = [
      dau.time,
      `上行消息量: ${dau.msg_count}`,
      `下行消息量: ${dau.send_count}`,
      `上行消息人数: ${dau.user_count}`,
      `上行消息群数: ${dau.group_count}`,
      ''
    ]
    const path = join(process.cwd(), 'data', 'QQBotDAU', uin)
    // 昨日DAU
    try {
      let date = new Date(dau.time)
      date.setDate(date.getDate() - 1)
      let yesterday = date.toISOString().slice(0, 10)
      let yesterdayDau = fs.readFileSync(join(path, `${yesterday}.json`), 'utf-8')
      yesterdayDau = JSON.parse(yesterdayDau)
      msg.push(...[
        yesterdayDau.time,
        `上行消息量: ${yesterdayDau.msg_count}`,
        `下行消息量: ${yesterdayDau.send_count}`,
        `上行消息人数: ${yesterdayDau.user_count}`,
        `上行消息群数: ${yesterdayDau.group_count}`,
        ''
      ])
    } catch (error) { }
    const totalDAU = {
      user_count: 0,
      group_count: 0,
      msg_count: 0,
      send_count: 0
    }
    let day_count = 0
    const date = new Date(dau.time)
    for (let i = 1; i <= 30; i++) {
      date.setDate(date.getDate() - 1)
      const time = date.toISOString().slice(0, 10)
      try {
        let dayDau = fs.readFileSync(join(path, `${time}.json`), 'utf-8')
        dayDau = JSON.parse(dayDau)
        for (const i in totalDAU) {
          if (dayDau[i]) {
            totalDAU[i] += Number(dayDau[i]) || String(dayDau[i])
          }
        }
        day_count++
      } catch (error) { }
    }
    if (day_count > 1) {
      for (const i in totalDAU) {
        totalDAU[i] = Math.floor(totalDAU[i] / day_count)
      }
      msg.push(...[
        `最近${numToChinese[day_count] || day_count}天平均DAU`,
        `上行消息量: ${totalDAU.msg_count}`,
        `下行消息量: ${totalDAU.send_count}`,
        `上行消息人数: ${totalDAU.user_count}`,
        `上行消息群数: ${totalDAU.group_count}`
      ])
    }

    if (pro) {
      if (!fs.existsSync(path)) return false
      let daus = fs.readdirSync(path)
      if (_.isEmpty(daus)) return false
      daus = daus.map(v => JSON.parse(fs.readFileSync(`${path}/${v}`)))
      let data = _.groupBy(daus, v => moment(v.time).format('yyyy-MM'))
      // 月度统计
      _.each(data, (v, k) => {
        let coldata = []
        let linedata = []
        _.each(v, day => {
          let user = {
            name: '上行消息人数',
            count: day.user_count,
            time: day.time
          }
          let group = {
            name: '上行消息群数',
            count: day.group_count,
            time: day.time
          }
          let msg = {
            linename: '上行消息量',
            linecount: day.msg_count,
            time: day.time
          }
          let send = {
            linename: '下行消息量',
            linecount: day.send_count,
            time: day.time
          }
          coldata.push(user, group)
          linedata.push(msg, send)
        })
        data[k] = [linedata, coldata]
      })

      totalDAU.days = numToChinese[day_count] || day_count
      let renderdata = {
        daus: JSON.stringify(data),
        totalDAU,
        todayDAU: dau,
        monthly: _.keys(data).reverse(),
        nickname: Bot[uin].nickname,
        avatar: Bot[uin].avatar,
        tplFile: `${process.cwd()}/plugins/QQBot-Plugin/resources/html/DAU/DAU.html`,
        pluResPath: `${process.cwd()}/plugins/QQBot-Plugin/resources/`,
        _res_Path: `${process.cwd()}/plugins/genshin/resources/`
      }
      let img = await puppeteer.screenshot('DAU', renderdata)
      if (img) this.reply(img)
      return true
    }
    this.reply(msg.join('\n'), true)
  }
}

logger.info(logger.green('- QQBot 适配器插件 加载完成'))

async function getDAU(uin) {
  const time = getNowDate()
  const msg_count = (await redis.get(`QQBotDAU:msg_count:${uin}`)) || 0
  const send_count = (await redis.get(`QQBotDAU:send_count:${uin}`)) || 0
  let data = await redis.get(`QQBotDAU:${uin}`)
  if (data) {
    data = JSON.parse(data)
    data.msg_count = Number(msg_count)
    data.send_count = Number(send_count)
    data.time = time
    return data
  } else {
    return {
      user_count: 0,  // 上行消息人数
      group_count: 0, // 上行消息群数
      msg_count,      // 上行消息量
      send_count,     // 下行消息量
      user_cache: {},
      group_cache: {},
      time
    }
  }
}

function getNowDate() {
  const date = new Date()
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [{ value: month }, , { value: day }, , { value: year }] = dtf.formatToParts(date)
  return `${year}-${month}-${day}`
}

// 每天零点清除DAU统计并保存到文件
schedule.scheduleJob('0 0 0 * * ?', () => {
  const time = getNowDate()
  const path = join(process.cwd(), 'data', 'QQBotDAU')
  if (!fs.existsSync(path)) fs.mkdirSync(path)
  for (const key in DAU) {
    try {
      const data = DAU[key]
      delete data.user_cache
      delete data.group_cache
      DAU[key] = {
        user_count: 0,
        group_count: 0,
        msg_count: 0,
        send_count: 0,
        user_cache: {},
        group_cache: {},
        time
      }
      if (!fs.existsSync(join(path, key))) fs.mkdirSync(join(path, key))
      fs.writeFile(join(path, key, `${data.time}.json`), JSON.stringify(data), 'utf-8', () => { })
    } catch (error) {
      logger.error('清除DAU数据出错,key: ' + key, error)
    }
  }
})

// 硬核
const numToChinese = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九', 10: '十',
  11: '十一', 12: '十二', 13: '十三', 14: '十四', 15: '十五',
  16: '十六', 17: '十七', 18: '十八', 19: '十九', 20: '二十',
  21: '二十一', 22: '二十二', 23: '二十三', 24: '二十四', 25: '二十五',
  26: '二十六', 27: '二十七', 28: '二十八', 29: '二十九', 30: '三十'
}

logger.info(logger.yellow('- 正在加载 QQBot 适配器插件'))

import makeConfig from '../../lib/plugins/config.js'
import fs from 'node:fs'
import { join } from 'node:path'
import QRCode from 'qrcode'
import imageSize from 'image-size'
import { randomUUID } from 'node:crypto'
import { encode as encodeSilk } from 'silk-wasm'
import { Bot as QQBot } from 'qq-group-bot'
import moment from 'moment'
import schedule from 'node-schedule'
import Runtime from '../../lib/plugins/runtime.js'
import Handler from '../../lib/plugins/handler.js'
import puppeteer from '../../lib/puppeteer/puppeteer.js'
import _ from 'lodash'
import { Level } from 'level'
import YAML from 'yaml'

const userIdCache = {}
const DAU = {}
const callStats = {}
const userStats = {}
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

let { config, configSave } = await makeConfig('QQBot', {
  tips: '',
  permission: 'master',
  toQRCode: true,
  toCallback: true,
  toBotUpload: true,
  toQQUin: false,
  toImg: true,
  saveDBFile: false,
  callStats: false,
  userStats: false,
  markdown: {},
  customMD: {},
  mdSuffix: {},
  btnSuffix: {},
  bot: {
    sandbox: false,
    maxRetry: Infinity
  },
  token: []
}, {
  tips: [
    '欢迎使用 TRSS-Yunzai QQBot Plugin ! 作者：时雨🌌星空 & 小叶',
    '参考：https://github.com/xiaoye12123/Yunzai-QQBot-Plugin'
  ]
})

const adapter = new class QQBotAdapter {
  constructor() {
    this.id = 'QQBot'
    this.name = 'QQBot'
    this.path = 'data/QQBot/'
    this.version = 'qq-group-bot v11.45.14'

    if (typeof config.toQRCode == 'boolean') this.toQRCodeRegExp = config.toQRCode ? /https?:\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])?/g : false
    else this.toQRCodeRegExp = new RegExp(config.toQRCode, 'g')

    this.sep = ':'
    if (process.platform == 'win32') this.sep = config.sep || ''
    this.bind_user = {}
  }

  async makeVideo(file) {
    if (config.toBotUpload) {
      for (const i of Bot.uin) {
        if (!Bot[i].uploadVideo) continue
        try {
          const url = await Bot[i].uploadVideo(file)
          if (url) return url
        } catch (err) {
          Bot.makeLog('error', ['Bot', i, '视频上传错误', file, err])
        }
      }
    }
    return Bot.fileToUrl(file)
  }

  async makeRecord(file) {
    if (config.toBotUpload) {
      for (const i of Bot.uin) {
        if (!Bot[i].uploadRecord) continue
        try {
          const url = await Bot[i].uploadRecord(file)
          if (url) return url
        } catch (err) {
          Bot.makeLog('error', ['Bot', i, '语音上传错误', file, err])
        }
      }
    }

    const inputFile = join('temp', randomUUID())
    const pcmFile = join('temp', randomUUID())

    try {
      fs.writeFileSync(inputFile, await Bot.Buffer(file))
      await Bot.exec(`ffmpeg -i "${inputFile}" -f s16le -ar 48000 -ac 1 "${pcmFile}"`)
      file = Buffer.from((await encodeSilk(fs.readFileSync(pcmFile), 48000)).data)
    } catch (err) {
      logger.error(`silk 转码错误：${err}`)
    }

    for (const i of [inputFile, pcmFile]) {
      try {
        fs.unlinkSync(i)
      } catch (err) { }
    }
    return Bot.fileToUrl(file)
  }

  async makeQRCode(data) {
    return (await QRCode.toDataURL(data)).replace('data:image/png;base64,', 'base64://')
  }

  async makeRawMarkdownText(data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) {
      for (const url of match) {
        button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
        const img = await this.makeMarkdownImage(await this.makeQRCode(url))
        text = text.replace(url, `${img.des}${img.url}`)
      }
    }
    return text.replace(/@/g, '@​')
  }

  async makeBotImage(file) {
    if (config.toBotUpload) {
      for (const i of Bot.uin) {
        if (!Bot[i].uploadImage) continue
        try {
          const image = await Bot[i].uploadImage(file)
          if (image.url) return image
        } catch (err) {
          Bot.makeLog('error', ['Bot', i, '图片上传错误', file, err])
        }
      }
    }
  }

  async makeMarkdownImage(file) {
    const image = await this.makeBotImage(file) || {
      url: await Bot.fileToUrl(file)
    }

    if (!image.width || !image.height) {
      try {
        const size = imageSize(await Bot.Buffer(file))
        image.width = size.width
        image.height = size.height
      } catch (err) {
        Bot.makeLog('error', ['图片分辨率检测错误', file, err])
      }
    }

    return {
      des: `![图片 #${image.width || 0}px #${image.height || 0}px]`,
      url: `(${image.url})`
    }
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

    if (button.input) {
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.input,
        enter: button.send,
        ...button.QQBot?.action
      }
    } else if (button.callback) {
      if (config.toCallback) {
        msg.action = {
          type: 1,
          permission: { type: 2 },
          ...button.QQBot?.action
        }
        if (!Array.isArray(data._ret_id)) data._ret_id = []

        data.bot.callback[msg.id] = {
          id: data.message_id,
          user_id: data.user_id,
          group_id: data.group_id,
          message: button.callback,
          message_id: data._ret_id
        }
        setTimeout(() => delete data.bot.callback[msg.id], 300000)
      } else {
        msg.action = {
          type: 2,
          permission: { type: 2 },
          data: button.callback,
          enter: true,
          ...button.QQBot?.action
        }
      }
    } else if (button.link) {
      msg.action = {
        type: 0,
        permission: { type: 2 },
        data: button.link,
        ...button.QQBot?.action
      }
    } else return false

    if (button.permission) {
      if (button.permission == 'admin') {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission)) button.permission = [button.permission]
        for (let id of button.permission) {
          if (config.toQQUin && userIdCache[id]) id = userIdCache[id]
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this.sep}`, ''))
        }
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
      if (buttons.length) { msgs.push({ type: 'button', buttons }) }
    }
    return msgs
  }

  async makeRawMarkdownMsg(data, msg) {
    const messages = []
    let content = ''
    const button = []
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
          messages.push([i])
          break
        case 'video':
          i.file = await this.makeVideo(i.file)
          messages.push([i])
          break
        case 'file':
          if (i.file) i.file = await Bot.fileToUrl(i.file, i, type)
          content += await this.makeRawMarkdownText(data, `文件：${i.file}`, button)
          break
        case 'at':
          if (i.qq == 'all') { content += '@everyone' } else { content += `<@${i.qq.replace(`${data.self_id}${this.sep}`, '')}>` }
          break
        case 'text':
          content += await this.makeRawMarkdownText(data, i.text, button)
          break
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(i.file)
          content += `${des}${url}`
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
          for (const { message } of i.data) { messages.push(...(await this.makeRawMarkdownMsg(data, message))) }
          continue
        case 'raw':
          messages.push([i.data])
          break
        default:
          content += await this.makeRawMarkdownText(data, JSON.stringify(i), button)
      }
    }

    if (content) { messages.unshift([{ type: 'markdown', content }]) }

    if (button.length) {
      for (const i of messages) {
        if (i[0].type == 'markdown') { i.push(...button.splice(0, 5)) }
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          { type: 'markdown', content: ' ' },
          ...button.splice(0, 5)
        ])
      }
    }

    if (reply) {
      for (const i in messages) {
        if (Array.isArray(messages[i])) messages[i].unshift(reply)
        else messages[i] = [reply, messages[i]]
      }
    }
    return messages
  }

  makeMarkdownText(data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) {
      for (const url of match) {
        button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
        text = text.replace(url, '[链接(请点击按钮查看)]')
      }
    }
    return text.replace(/\n/g, '\r').replace(/@/g, '@​')
  }

  makeMarkdownTemplate(data, template) {
    const params = []
    const custom = config.customMD?.[data.self_id]
    const keys = Object.keys(template)
    const mdKeys = custom?.keys || ['a', 'b']
    for (const i of mdKeys || ['a', 'b']) {
      if (custom && keys.length) {
        params.push({ key: i, values: [template[keys.shift()]] })
      } else if (template[i]) {
        params.push({ key: i, values: [template[i]] })
      }
    }
    if (config.mdSuffix?.[data.self_id]) {
      for (const i of config.mdSuffix[data.self_id]) {
        const index = params.findIndex(k => k.key == i.key)
        if (index > -1) {
          params[index].values[0] += i.values[0]
        } else {
          params.push(i)
        }
      }
    }
    return {
      type: 'markdown',
      custom_template_id: custom?.custom_template_id || config.markdown[data.self_id],
      params
    }
  }

  async makeMarkdownMsg(data, msg) {
    const messages = []
    let content = ''
    let button = []
    let template = {}
    let reply
    let raw = []

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') i = { ...i }
      else i = { type: 'text', text: i }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
          messages.push([i])
          break
        case 'video':
          i.file = await this.makeVideo(i.file)
          messages.push([i])
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
          content += this.makeMarkdownText(data, i.text, button)
          break
        case 'node':
          if (Handler.has('ws.tool.toImg') && config.toImg) {
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
            for (const { message } of i.data) {
              messages.push(...(await this.makeMarkdownMsg(data, message)))
            }
            continue
          }
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(i.file)

          if (template.b) {
            template.b += content
            messages.push([this.makeMarkdownTemplate(data, template)])
            content = ''
            button = []
          }

          template = {
            a: content + des,
            b: url
          }
          content = ''
          break
        } case 'markdown':
          if (typeof i.data == 'object') messages.push([{ type: 'markdown', ...i.data }])
          else messages.push([{ type: 'markdown', content: i.data }])
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
        case 'custom':
          messages.push([this.makeMarkdownTemplate(data, i.data)])
          break
        default:
          content += this.makeMarkdownText(data, JSON.stringify(i), button)
      }
    }
    if (raw.length) messages.push(raw)

    if (template.b) template.b += content
    else if (content) template = { a: content }

    if (template.a) messages.push([this.makeMarkdownTemplate(data, template)])

    if (button.length < 5 && config.btnSuffix[data.self_id]) {
      let { position, values } = config.btnSuffix[data.self_id]
      position = +position - 1
      if (position > button.length) {
        position = button.length
      }
      button.splice(position, 0, ...this.makeButtons(data, [values]))
    }

    if (button.length) {
      for (const i of messages) {
        if (i[0].type == 'markdown') i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          this.makeMarkdownTemplate(data, { a: ' ' }),
          ...button.splice(0, 5)
        ])
      }
    }
    if (reply) {
      for (const i of messages) {
        i.unshift(reply)
      }
    }
    return messages
  }

  async makeMsg(data, msg) {
    const sendType = ['audio', 'image', 'video', 'file']
    const messages = []
    let message = []
    const button = []
    let reply
    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'at':
          // if (config.toQQUin && userIdCache[user_id]) {
          //   i.qq = userIdCache[user_id]
          // }
          // i.qq = i.qq.replace(`${data.self_id}${this.sep}`, "")
          continue
        case 'text':
        case 'face':
        case 'ark':
        case 'embed':
          break
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
          if (message.length) {
            messages.push(message)
            message = []
          }
          break
        case 'video':
          i.file = await this.makeVideo(i.file)
          if (message.length) {
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
          if (typeof i.data == 'object') { i = { type: 'markdown', ...i.data } } else { i = { type: 'markdown', content: i.data } }
          break
        case 'button':
          button.push(...this.makeButtons(data, i.data))
          continue
        case 'node':
          if (Handler.has('ws.tool.toImg') && config.toImg) {
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
            // i.file = await Bot.fileToUrl(i.file)
            if (message.some(s => sendType.includes(s.type))) {
              messages.push(message)
              message = []
            }
          } else {
            for (const { message } of i.data) { messages.push(...(await this.makeMsg(data, message))) }
            break
          }
        case 'image':
          const image = await this.makeBotImage(i.file)
          i.file = image?.url || await Bot.fileToUrl(i.file)
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
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
        if (match) {
          for (const url of match) {
            const msg = segment.image(await Bot.fileToUrl(await this.makeQRCode(url)))
            if (message.some(s => sendType.includes(s.type))) {
              messages.push(message)
              message = []
            }
            message.push(msg)
            i.text = i.text.replace(url, '[链接(请扫码查看)]')
          }
        }
      }

      message.push(i)
    }
    if (message.length) { messages.push(message) }

    while (button.length) {
      messages.push([{
        type: 'keyboard',
        content: { rows: button.splice(0, 5) }
      }])
    }

    if (reply) {
      for (const i of messages) i.unshift(reply)
    }
    return messages
  }

  async sendMsg(data, send, msg) {
    const rets = { message_id: [], data: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          Bot.makeLog('debug', ['发送消息', i], data.self_id)
          const ret = await send(i)
          Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

          rets.data.push(ret)
          if (ret.msg_id) rets.message_id.push(ret.msg_id)
          setDAU(data, 'send_count')
        } catch (err) {
          if (err.response?.data) {
            const trace_id = err.response.headers?.['x-tps-trace-id'] || err.trace_id
            err = { ...err.response.data, trace_id }
          }
          Bot.makeLog('error', ['发送消息错误', i, err], data.self_id)
          return false
        }
      }
    }

    if ((config.markdown[data.self_id] || (data.toQQBotMD === true && config.customMD[data.self_id])) && data.toQQBotMD !== false) {
      if (config.markdown[data.self_id] == 'raw') { msgs = await this.makeRawMarkdownMsg(data, msg) } else { msgs = await this.makeMarkdownMsg(data, msg) }
    } else {
      msgs = await this.makeMsg(data, msg)
    }

    if (await sendMsg() === false) {
      msgs = await this.makeMsg(data, msg)
      await sendMsg()
    }

    setLogFnc(data)

    if (Array.isArray(data._ret_id)) { data._ret_id.push(...rets.message_id) }
    return rets
  }

  sendFriendMsg(data, msg, event) {
    return this.sendMsg(data, msg => data.bot.sdk.sendPrivateMessage(data.user_id, msg, event), msg)
  }

  sendGroupMsg(data, msg, event) {
    return this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(data.group_id, msg, event), msg)
  }

  async makeGuildMsg(data, msg) {
    const messages = []
    let message = []
    let reply
    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'at':
          i.user_id = i.qq.replace(/^qg_/, '')
        case 'text':
        case 'face':
        case 'ark':
        case 'embed':
          break
        case 'image':
          message.push(i)
          messages.push(message)
          message = []
          continue
        case 'record':
        case 'video':
        case 'file':
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          i = { type: 'text', text: `文件：${i.file}` }
          break
        case 'reply':
          reply = i
          continue
        case 'markdown':
          if (typeof i.data == 'object') { i = { type: 'markdown', ...i.data } } else { i = { type: 'markdown', content: i.data } }
          break
        case 'button':
          continue
        case 'node':
          for (const { message } of i.data) { messages.push(...(await this.makeGuildMsg(data, message))) }
          continue
        case 'raw':
          i = i.data
          break
        default:
          i = { type: 'text', text: JSON.stringify(i) }
      }

      if (i.type == 'text' && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) {
          for (const url of match) {
            const msg = segment.image(await this.makeQRCode(url))
            message.push(msg)
            messages.push(message)
            message = []
            i.text = i.text.replace(url, '[链接(请扫码查看)]')
          }
        }
      }

      message.push(i)
    }

    if (message.length) {
      messages.push(message)
    }
    if (reply) {
      for (const i of messages) i.unshift(reply)
    }
    return messages
  }

  async sendGMsg(data, send, msg) {
    const rets = { message_id: [], data: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          Bot.makeLog('debug', ['发送消息', i], data.self_id)
          const ret = await send(i)
          Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
          setDAU(data, 'send_count')
        } catch (err) {
          Bot.makeLog('error', ['发送消息错误', i, err], data.self_id)
          return false
        }
      }
    }

    msgs = await this.makeGuildMsg(data, msg)
    if (await sendMsg() === false) {
      msgs = await this.makeGuildMsg(data, msg)
      await sendMsg()
    }
    if (!data.QQBotSetLogFnc) {
      setLogFnc(data)
      data.QQBotSetLogFnc = true
    }
    return rets
  }

  async sendDirectMsg(data, msg, event) {
    if (!data.guild_id) {
      if (!data.src_guild_id) {
        Bot.makeLog('error', [`发送频道消息失败：[${data.user_id}] 不存在来源频道信息`, msg], data.self_id)
        return false
      }
      const dms = await data.bot.sdk.createDirectSession(data.src_guild_id, data.user_id)
      data.guild_id = dms.guild_id
      data.channel_id = dms.channel_id
      data.bot.fl.set(`qg_${data.user_id}`, {
        ...data.bot.fl.get(`qg_${data.user_id}`),
        ...dms
      })
    }
    return this.sendGMsg(data, msg => data.bot.sdk.sendDirectMessage(data.guild_id, msg, event), msg)
  }

  sendGuildMsg(data, msg, event) {
    return this.sendGMsg(data, msg => data.bot.sdk.sendGuildMessage(data.channel_id, msg, event), msg)
  }

  pickFriend(id, user_id) {
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
      sendMsg: msg => this.sendFriendMsg(i, msg),
      getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`
    }
  }

  pickMember(id, group_id, user_id) {
    if (config.toQQUin && userIdCache[user_id]) {
      user_id = userIdCache[user_id]
    }
    if (user_id.startsWith('qg_')) { return this.pickGuildMember(id, group_id, user_id) }
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

  pickGroup(id, group_id) {
    if (group_id.startsWith('qg_')) { return this.pickGuild(id, group_id) }
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id)
    }
  }

  pickGuildFriend(id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(/^qg_/, '')
    }
    return {
      ...i,
      sendMsg: msg => this.sendDirectMsg(i, msg)
    }
  }

  pickGuildMember(id, group_id, user_id) {
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
      ...this.pickFriend(id, user_id),
      ...i
    }
  }

  pickGuild(id, group_id) {
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
      sendMsg: msg => this.sendGuildMsg(i, msg),
      pickMember: user_id => this.pickGuildMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id)
    }
  }

  makeFriendMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`
    }
    Bot.makeLog('info', `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendFriendMsg({
      ...data, user_id: event.sender.user_id
    }, msg, { id: data.message_id })
    this.setFriendMap(data)
  }

  async makeGroupMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`
    }
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    if (config.toQQUin && typeof findUser_id === 'function') {
      const user_id = await findUser_id({ user_id: data.user_id })
      if (user_id?.custom) {
        userIdCache[user_id.custom] = data.user_id
        data.sender.user_id = user_id.custom
      }
    }
    Bot.makeLog('info', `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGroupMsg({
      ...data, group_id: event.group_id
    }, msg, { id: data.message_id })
  }

  makeDirectMessage(data, event) {
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
    Bot.makeLog('info', `频道私聊消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendDirectMsg({
      ...data,
      user_id: event.user_id,
      guild_id: event.guild_id,
      channel_id: event.channel_id
    }, msg, { id: data.message_id })
    this.setFriendMap(data)
  }

  async makeGuildMessage(data, event) {
    data.message_type = 'group'
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      card: event.member.nick,
      avatar: event.author.avatar,
      src_guild_id: event.guild_id,
      src_channel_id: event.channel_id
    }
    if (config.toQQUin && typeof findUser_id === 'function') {
      const user_id = await findUser_id({ user_id: data.user_id })
      if (user_id?.custom) {
        userIdCache[user_id.custom] = data.user_id
        data.sender.user_id = user_id.custom
      }
    }
    data.group_id = `qg_${event.guild_id}-${event.channel_id}`
    Bot.makeLog('info', `频道消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGuildMsg({
      ...data,
      guild_id: event.guild_id,
      channel_id: event.channel_id
    }, msg, { id: data.message_id })
    this.setFriendMap(data)
    this.setGroupMap(data)
  }

  setFriendMap(data) {
    if (!data.user_id) return
    data.bot.fl.set(data.user_id, {
      ...data.bot.fl.get(data.user_id),
      ...data.sender
    })
  }

  setGroupMap(data) {
    if (!data.group_id) return
    data.bot.gl.set(data.group_id, {
      ...data.bot.gl.get(data.group_id),
      group_id: data.group_id
    })
    let gml = data.bot.gml.get(data.group_id)
    if (!gml) {
      gml = new Map()
      data.bot.gml.set(data.group_id, gml)
    }
    gml.set(data.user_id, {
      ...gml.get(data.user_id),
      ...data.sender
    })
  }

  async makeMessage(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
      get user_id() { return this.sender.user_id },
      message: event.message,
      raw_message: event.raw_message
    }

    for (const i of data.message) {
      switch (i.type) {
        case 'at':
          if (data.message_type == 'group') i.qq = `${data.self_id}${this.sep}${i.user_id}`
          else i.qq = `qg_${i.user_id}`
          break
      }
    }

    switch (data.message_type) {
      case 'private':
      case 'direct':
        if (data.sub_type == 'friend') { this.makeFriendMessage(data, event) } else { this.makeDirectMessage(data, event) }
        break
      case 'group':
        await this.makeGroupMessage(data, event)
        break
      case 'guild':
        await this.makeGuildMessage(data, event)
        if (data.message.length === 0) {
          // tx.sb 群有一个空格频道没有
          data.message.push({ type: 'text', text: '' })
        }
        break
      default:
        Bot.makeLog('warn', ['未知消息', event], id)
        return
    }

    data.bot.stat.recv_msg_cnt++
    setDAU(data, 'msg_count')
    setUserStats(data.self_id, data.user_id)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeBotCallback(id, event, callback) {
    const data = {
      raw: event,
      bot: Bot[callback.self_id],
      self_id: callback.self_id,
      post_type: 'message',
      message_id: event.notice_id,
      message_type: callback.group_id ? 'group' : 'private',
      sub_type: 'callback',
      get user_id() { return this.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: ''
    }

    data.message.push(
      { type: 'at', qq: callback.self_id },
      { type: 'text', text: callback.message }
    )
    data.raw_message += callback.message

    if (callback.group_id) {
      data.group_id = callback.group_id
      data.group = data.bot.pickGroup(callback.group_id)
      data.group_name = data.group.name
      data.friend = Bot[id].pickFriend(data.user_id)
      if (data.friend.real_id) {
        data.friend = data.bot.pickFriend(data.friend.real_id)
        data.member = data.group.pickMember(data.friend.user_id)
        data.sender = {
          ...await data.member.getInfo() || data.member
        }
      } else {
        if (callback[data.user_id]) { return event.reply(3) }
        callback[data.user_id] = true

        let msg = `请先发送 #QQBot绑定用户${data.user_id}`
        const real_id = callback.message.replace(/^#[Qq]+[Bb]ot绑定用户确认/, '').trim()
        if (this.bind_user[real_id] == data.user_id) {
          Bot[id].fl.set(data.user_id, {
            ...Bot[id].fl.get(data.user_id), real_id
          })
          msg = `绑定成功 ${data.user_id} → ${real_id}`
        }
        event.reply(0)
        return data.group.sendMsg(msg)
      }
      Bot.makeLog('info', [`群按钮点击事件：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})]`, data.raw_message], data.self_id)
    } else {
      Bot[id].fl.set(data.user_id, {
        ...Bot[id].fl.get(data.user_id),
        real_id: callback.user_id
      })
      data.friend = data.bot.pickFriend(callback.user_id)
      data.sender = {
        ...await data.friend.getInfo() || data.friend
      }
      Bot.makeLog('info', [`好友按钮点击事件：[${data.sender.nickname}(${data.user_id})]`, data.raw_message], data.self_id)
    }
    event.reply(0)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  makeCallback(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: 'message',
      message_id: event.notice_id,
      message_type: event.notice_type,
      sub_type: 'callback',
      get user_id() { return this.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: ''
    }

    const callback = data.bot.callback[event.data?.resolved?.button_id]
    if (callback) {
      if (callback.self_id) { return this.makeBotCallback(id, event, callback) }
      if (!event.group_id && callback.group_id) { event.group_id = callback.group_id }
      data.message_id = callback.id
      if (callback.message_id.length) {
        for (const id of callback.message_id) { data.message.push({ type: 'reply', id }) }
        data.raw_message += `[回复：${callback.message_id}]`
      }
      data.message.push({ type: 'text', text: callback.message })
      data.raw_message += callback.message
    } else {
      if (event.data?.resolved?.button_id) {
        data.message.push({ type: 'reply', id: event.data?.resolved?.button_id })
        data.raw_message += `[回复：${event.data?.resolved?.button_id}]`
      }
      if (event.data?.resolved?.button_data) {
        data.message.push({ type: 'text', text: event.data?.resolved?.button_data })
        data.raw_message += event.data?.resolved?.button_data
      } else {
        event.reply(1)
      }
    }
    event.reply(0)

    switch (data.message_type) {
      case 'direct':
      case 'friend':
        data.message_type = 'private'
        Bot.makeLog('info', [`好友按钮点击事件：[${data.user_id}]`, data.raw_message], data.self_id)

        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.operator_id }, msg, { id: data.message_id })
        this.setFriendMap(data)
        break
      case 'group':
        data.group_id = `${id}${this.sep}${event.group_id}`
        Bot.makeLog('info', [`群按钮点击事件：[${data.group_id}, ${data.user_id}]`, data.raw_message], data.self_id)

        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
        this.setGroupMap(data)
        break
      case 'guild':
        break
      default:
        Bot.makeLog('warn', ['未知按钮点击事件', event], data.self_id)
    }

    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
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
      group_id: event.group_id
    }

    switch (data.sub_type) {
      case 'action':
        return this.makeCallback(id, event)
      case 'increase':
        setDAU(data, 'group_increase_count')
        if (event.notice_type === 'group') {
          const path = join(process.cwd(), 'plugins', 'QQBot-Plugin', 'Model', 'groupIncreaseMsg.js')
          if (fs.existsSync(path)) {
            import(`file://${path}`).then(i => i.default).then(async i => {
              let msg
              if (typeof i === 'function') {
                msg = await i(`${data.self_id}${this.sep}${event.group_id}`, `${data.self_id}${this.sep}${event.user_id || event.operator_id}`, data.self_id)
              } else {
                msg = i
              }
              if (msg?.length > 0) {
                this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(event.group_id, msg), msg)
              }
            })
          }
        }
        return
      case 'decrease':
        setDAU(data, 'group_decrease_count')
      case 'update':
      case 'member.increase':
      case 'member.decrease':
      case 'member.update':
        break
      default:
        Bot.makeLog('warn', ['未知通知', event], id)
        return
    }

    //Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
  }

  getFriendMap(id) {
    return config.saveDBFile ? Bot.getMap(`${this.path}${id}/Friend`) : new Map()
  }

  getGroupMap(id) {
    return config.saveDBFile ? Bot.getMap(`${this.path}${id}/Group`) : new Map()
  }

  getMemberMap(id) {
    return config.saveDBFile ? Bot.getMap(`${this.path}${id}/Member`) : new Map()
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
      ]
    }

    if (Number(token[4])) opts.intents.push('GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE')

    if (Number(token[5])) opts.intents.push('GUILD_MESSAGES')
    else opts.intents.push('PUBLIC_GUILD_MESSAGES')

    Bot[id] = {
      adapter: this,
      sdk: new QQBot(opts),
      login() { return this.sdk.start() },

      uin: id,
      info: { id, ...opts },
      get nickname() { return this.sdk.nickname },
      get avatar() { return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${id}` },

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
      gml: this.getMemberMap(id),

      callback: {}
    }

    await Bot[id].login()

    Bot[id].sdk.logger = {}
    for (const i of ['trace', 'debug', 'info', 'mark', 'warn', 'error', 'fatal']) { Bot[id].sdk.logger[i] = (...args) => Bot.makeLog(i, args, id) }

    Bot[id].sdk.on('message', event => this.makeMessage(id, event))
    Bot[id].sdk.on('notice', event => this.makeNotice(id, event))

    logger.mark(`${logger.blue(`[${id}]`)} ${this.name}(${this.id}) ${this.version} 已连接`)
    Bot.em(`connect.${id}`, { self_id: id })
    DAU[id] = await getDAU(id)
    callStats[id] = await getCallStats(id)
    await initUserStats(id)
    return true
  }

  async load() {
    for (const token of config.token) {
      await new Promise(resolve => {
        adapter.connect(token).then(resolve)
        setTimeout(resolve, 5000)
      })
    }
  }
}()

Bot.adapter.push(adapter)

const setMap = {
  '二维码': 'toQRCode',
  '按钮回调': 'toCallback',
  '转换': 'toQQUin',
  '转图片': 'toImg',
  '调用统计': 'callStats',
  '用户统计': 'userStats',
}

export class QQBotAdapter extends plugin {
  constructor() {
    super({
      name: 'QQBotAdapter',
      dsc: 'QQBot 适配器设置',
      event: 'message',
      rule: [
        {
          reg: '^#[Qq]+[Bb]ot(帮助|help)$',
          fnc: 'help',
          permission: config.permission
        },
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
          reg: `^#[Qq]+[Bb]ot设置(${Object.keys(setMap).join('|')})\\s*(开启|关闭)$`,
          fnc: 'Setting',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot[Dd][Aa][Uu]',
          fnc: 'DAUStat',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot调用统计$',
          fnc: 'callStat',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot用户统计$',
          fnc: 'userStat',
          permission: config.permission
        },
        {
          reg: '^#[Qq]+[Bb]ot绑定用户.+$',
          fnc: 'BindUser'
        },
        {
          reg: '^#[Qq]+[Bb]ot刷新co?n?fi?g$',
          fnc: 'refConfig',
          permission: config.permission
        }
      ]
    })
  }

  async init() {
    // dau数据合并
    let dauPath = './data/QQBotDAU'
    if (fs.existsSync(dauPath)) {
      this.mergeDAU(dauPath)
    }
  }

  help() {
    this.reply([' ', segment.button(
      [
        { text: 'dau', callback: '#QQBotdau' },
        { text: 'daupro', callback: '#QQBotdaupro' },
        { text: '调用统计', callback: '#QQBot调用统计' },
        { text: '用户统计', callback: '#QQBot用户统计' },
      ],
      [
        { text: `${config.toCallback ? '关闭' : '开启'}按钮回调`, callback: `#QQBot设置按钮回调${config.toCallback ? '关闭' : '开启'}` },
        { text: `${config.callStats ? '关闭' : '开启'}调用统计`, callback: `#QQBot设置调用统计${config.callStats ? '关闭' : '开启'}` },
      ],
      [
        { text: `${config.userStats ? '关闭' : '开启'}用户统计`, callback: `#QQBot设置用户统计${config.userStats ? '关闭' : '开启'}` },
      ]
    )])
  }

  refConfig() {
    config = YAML.parse(fs.readFileSync('config/QQBot.yaml', 'utf-8'))
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
    await configSave()
  }

  async Markdown() {
    let token = this.e.msg.replace(/^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?/, '').trim().split(':')
    const bot_id = token.shift()
    token = token.join(':')
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    await configSave()
  }

  async Setting() {
    const reg = /^#[Qq]+[Bb]ot设置(.+)\s*(开启|关闭)$/
    const regRet = reg.exec(this.e.msg)
    const state = regRet[2] == '开启'
    config[setMap[regRet[1]]] = state
    this.reply('设置成功,已' + (state ? '开启' : '关闭'), true)
    await configSave()
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
      `新增群数: ${dau.group_increase_count}`,
      `减少群数: ${dau.group_decrease_count}`,
      ''
    ]
    const path = join(process.cwd(), 'data', 'QQBotDAU', uin)
    const today = moment().format('YYYY-MM-DD')
    const yearMonth = moment(today).format('YYYY-MM')
    // 昨日DAU
    try {
      let yesterdayDau = JSON.parse(fs.readFileSync(join(path, `${yearMonth}.json`), 'utf8'))
      yesterdayDau = yesterdayDau.filter(v => moment(v.time).isSame(moment(today).subtract(1, 'days')))[0]
      msg.push(...[
        yesterdayDau.time,
        `上行消息量: ${yesterdayDau.msg_count}`,
        `下行消息量: ${yesterdayDau.send_count}`,
        `上行消息人数: ${yesterdayDau.user_count}`,
        `上行消息群数: ${yesterdayDau.group_count}`,
        `新增群数: ${yesterdayDau.group_increase_count}`,
        `减少群数: ${yesterdayDau.group_decrease_count}`,
        ''
      ])
    } catch (error) { }

    let totalDAU = {
      user_count: 0,
      group_count: 0,
      msg_count: 0,
      send_count: 0
    }
    let day_count = 0
    try {
      let days30 = [yearMonth, moment(yearMonth).subtract(1, 'months').format('YYYY-MM')]
      let dayDau = _.map(days30, v => {
        let file = join(path, `${v}.json`)
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')).reverse() : []
      })
      dayDau = _.take(_.flatten(dayDau), 30)
      day_count = dayDau.length
      _.each(totalDAU, (v, k) => {
        totalDAU[k] = _.floor(_.meanBy(dayDau, k))
      })
    } catch (error) { }
    msg.push(...[
      `最近${numToChinese[day_count] || day_count}天平均`,
      `上行消息量: ${totalDAU.msg_count}`,
      `下行消息量: ${totalDAU.send_count}`,
      `上行消息人数: ${totalDAU.user_count}`,
      `上行消息群数: ${totalDAU.group_count}`
    ])

    if (pro) {
      if (!fs.existsSync(path)) return false
      let daus = fs.readdirSync(path)
      if (_.isEmpty(daus)) return false
      let data = _.fromPairs(daus.map(v => [v.replace('.json', ''), JSON.parse(fs.readFileSync(`${path}/${v}`))]))
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
      if (img) this.reply([img, toButton()])
      return true
    }
    this.reply([msg.join('\n'), toButton()], true)
  }

  async callStat() {
    if (!config.callStats || !callStats[this.e.self_id]) return false
    const arr = Object.entries(callStats[this.e.self_id]).sort((a, b) => b[1] - a[1])
    const msg = [getDate(), '数据可能不准确,请自行识别']
    for (let i = 0; i < 10; i++) {
      if (!arr[i]) break
      const s = arr[i]
      msg.push(`${i + 1}: ${s[0].replace(/[^\[].*-[pP]lugin\/?/, '')}\t\t${s[1]}次`)
    }
    this.reply([msg.join('\n').replace(/(\[.*?\])(\[.*?\])/g, '$1 $2'), toButton()], true)
  }

  async userStat() {
    if (!config.userStats || !userStats[this.e.self_id]) return false
    const info = userStats[this.e.self_id]
    const stats = info[info.today].stats
    this.reply([[
      info.today,
      `新增用户: ${stats.increase_user_count}`,
      `减少用户: ${stats.decrease_user_count}`,
      `相同用户: ${stats.invariant_user_count}`,
    ].join('\n'), toButton()])
  }

  mergeDAU(dauPath) {
    let daus = this.getAllDAU(dauPath)
    if (!daus.length) return false

    daus = _.filter(daus, v => v.endsWith('.json'))
    if (_.some(daus, v => v.split('-').length === 2)) {
      const path2 = daus.find(v => v.includes('2024-03'))
      if (fs.existsSync(path2)) {
        const data2 = JSON.parse(fs.readFileSync(path2, 'utf8'))
        const errdata = data2.find(v => v.time === '2024-02-29')
        if (errdata) {
          const path1 = daus.find(v => v.includes('2024-02'))
          const data1 = fs.existsSync(path1) ? JSON.parse(fs.readFileSync(path1, 'utf8')) : []
          data1.push(errdata)
          fs.writeFile(path1, JSON.stringify(data1, '', '\t'), 'utf-8', () => { })
          fs.writeFile(path2, JSON.stringify(_.tail(data2), '', '\t'), 'utf-8', () => { })
        }
      }
      return false
    }

    daus = _.groupBy(daus, v => v.slice(0, v.lastIndexOf('/')))
    logger.info('[QQBOT]正在合并DAU数据中，请稍等...')

    try {
      _.each(daus, (v, k) => {
        let datas = _.map(v, f => JSON.parse(fs.readFileSync(f, 'utf8')))
        datas = _.groupBy(datas, d => moment(d.time).format('yyyy-MM'))
        _.each(datas, (data, month) => {
          fs.writeFileSync(`${k}/${month}.json`, JSON.stringify(data, '', '\t'), 'utf8')
        })

        if (!fs.existsSync('./temp/QQBotDAU')) fs.mkdirSync('./temp/QQBotDAU')
        let tempfolder = k.replace('./data', './temp')
        if (!fs.existsSync(tempfolder)) fs.mkdirSync(tempfolder)

        _.each(v, temp => {
          let tempfile = temp.replace('./data', './temp')
          fs.copyFileSync(temp, tempfile)
          fs.unlinkSync(temp)
        })
      })
      logger.info('[QQBOT]DAU数据合并成功！旧数据已迁移至temp/QQBotDAU目录')
    } catch (err) {
      logger.error('[QQBOT]DAU数据合并失败！')
      logger.error('[QQBOT]请自行删除data/QQBotDAU目录下文件名格式为20xx-xx-xx.json的文件，不要删错了哦~')
      return false
    }
  }

  getAllDAU(dauPath) {
    let dirs = fs.readdirSync(dauPath, { withFileTypes: true })
    if (_.isEmpty(dirs)) return dirs

    let daus = []
    _.each(dirs, v => {
      let currentPath = `${dauPath}/${v.name}`
      if (v.isDirectory()) {
        daus = daus.concat(this.getAllDAU(currentPath))
      } else daus.push(currentPath)
    })

    return daus
  }

  BindUser() {
    const id = this.e.msg.replace(/^#[Qq]+[Bb]ot绑定用户(确认)?/, '').trim()
    if (id == this.e.user_id) return this.reply('请切换到对应Bot')

    adapter.bind_user[this.e.user_id] = id
    this.reply([
      `绑定 ${id} → ${this.e.user_id}`,
      segment.button([{
        text: '确认绑定',
        callback: `#QQBot绑定用户确认${this.e.user_id}`,
        permission: this.e.user_id
      }])
    ])
  }
}

logger.info(logger.green('- QQBot 适配器插件 加载完成'))

function toButton() {
  return segment.button([
    { text: 'dau', callback: '#QQBotdau' },
    { text: 'daupro', callback: '#QQBotdaupro' },
  ], [
    { text: '调用统计', callback: '#QQBot调用统计' },
    { text: '用户统计', callback: '#QQBot用户统计' },
  ])
}

async function getDAU(uin) {
  const time = getDate()
  const msg_count = (await redis.get(`QQBotDAU:msg_count:${uin}`)) || 0
  const send_count = (await redis.get(`QQBotDAU:send_count:${uin}`)) || 0
  let data = await redis.get(`QQBotDAU:${uin}`)
  if (data) {
    data = JSON.parse(data)
    data.msg_count = Number(msg_count)
    data.send_count = Number(send_count)
    data.time = time
    if (!data.group_increase_count) {
      data.group_increase_count = 0
    }
    if (!data.group_decrease_count) {
      data.group_decrease_count = 0
    }
    return data
  } else {
    return {
      user_count: 0,  // 上行消息人数
      group_count: 0, // 上行消息群数
      msg_count,      // 上行消息量
      send_count,     // 下行消息量
      group_increase_count: 0, // 新增群数量
      group_decrease_count: 0, // 减少群数量
      user_cache: {},
      group_cache: {},
      time
    }
  }
}

/**
 * @param {'send_count'|'msg_count'|'group_increase_count'|'group_decrease_count'} type
 */
async function setDAU(data, type) {
  const time = moment(Date.now()).add(1, 'days').format('YYYY-MM-DD 00:00:00')
  const EX = Math.round(
    (new Date(time).getTime() - new Date().getTime()) / 1000
  )
  switch (type) {
    case 'send_count':
      DAU[data.self_id].send_count++
      redis.set(`QQBotDAU:send_count:${data.self_id}`, DAU[data.self_id].send_count * 1, { EX })
      break;
    case 'msg_count':
      let needSetRedis = false
      DAU[data.self_id].msg_count++
      if (data.group_id && !DAU[data.self_id].group_cache[data.group_id]) {
        DAU[data.self_id].group_cache[data.group_id] = 1
        DAU[data.self_id].group_count++
        needSetRedis = true
      }
      if (data.user_id && !DAU[data.self_id].user_cache[data.user_id]) {
        DAU[data.self_id].user_cache[data.user_id] = 1
        DAU[data.self_id].user_count++
        needSetRedis = true
      }
      if (needSetRedis) redis.set(`QQBotDAU:${data.self_id}`, JSON.stringify(DAU[data.self_id]), { EX })
      redis.set(`QQBotDAU:msg_count:${data.self_id}`, DAU[data.self_id].msg_count * 1, { EX })
      break
    case 'group_increase_count':
      let group_increase_list = await redis.get(`QQBot:group_increase_count:${data.self_id}`)
      if (group_increase_list) {
        group_increase_list = JSON.parse(group_increase_list)
      } else {
        group_increase_list = {}
      }
      if (!group_increase_list[data.group_id]) {
        DAU[data.self_id].group_increase_count++
        redis.set(`QQBotDAU:${data.self_id}`, JSON.stringify(DAU[data.self_id]), { EX })
        group_increase_list[data.group_id] = 1
        redis.set(`QQBot:group_increase_count:${data.self_id}`, JSON.stringify(group_increase_list), { EX })
      }
      break
    case 'group_decrease_count':
      let group_decrease_list = await redis.get(`QQBot:group_increase_count:${data.self_id}`)
      if (group_decrease_list) {
        group_decrease_list = JSON.parse(group_decrease_list)
      } else {
        group_decrease_list = {}
      }
      if (!group_decrease_list[data.group_id]) {
        DAU[data.self_id].group_decrease_count++
        redis.set(`QQBotDAU:${data.self_id}`, JSON.stringify(DAU[data.self_id]), { EX })
        group_decrease_list[data.group_id] = 1
        redis.set(`QQBot:group_decrease_list:${data.self_id}`, JSON.stringify(group_decrease_list), { EX })
      }
      break
    default:
      break;
  }
}

function getDate(d = 0) {
  const date = new Date()
  if (d != 0) date.setDate(date.getDate() + d)
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  const [{ value: month }, , { value: day }, , { value: year }] = dtf.formatToParts(date)
  return `${year}-${month}-${day}`
}

async function getCallStats(id) {
  const data = await redis.get(`QQBotCallStats:${id}`)
  if (data) return JSON.parse(data)
  return {}
}

const msg_id_cache = {}

async function setLogFnc(e) {
  if (!config.callStats || !e.logFnc || msg_id_cache[e.message_id]) return
  if (!callStats[e.self_id]) callStats[e.self_id] = {}
  const stats = callStats[e.self_id]
  if (!stats[e.logFnc]) stats[e.logFnc] = 0
  stats[e.logFnc]++
  const time = moment(Date.now()).add(1, 'days').format('YYYY-MM-DD 00:00:00')
  const EX = Math.round(
    (new Date(time).getTime() - new Date().getTime()) / 1000
  )
  redis.set(`QQBotCallStats:${e.self_id}`, JSON.stringify(stats), { EX })
  msg_id_cache[e.message_id] = setTimeout(() => {
    delete msg_id_cache[e.message_id]
  }, 60 * 5 * 1000)
}

// 每天零点清除DAU统计并保存到文件
schedule.scheduleJob('0 0 0 * * ?', () => {
  const yesMonth = moment().subtract(1, 'd').format('YYYY-MM')
  const time = getDate()
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
        group_increase_count: 0,
        group_decrease_count: 0,
        time
      }
      if (!fs.existsSync(join(path, key))) fs.mkdirSync(join(path, key))
      let filePath = join(path, key, `${yesMonth}.json`)
      let file = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : []
      file.push(data)
      fs.writeFile(filePath, JSON.stringify(file, '', '\t'), 'utf-8', () => { })
      initUserStats(key)
    } catch (error) {
      logger.error('清除DAU数据出错,key: ' + key, error)
    }
  }
  for (const key in callStats) {
    callStats[key] = {}
  }
})
// 相较于昨日
// 新增用户数
// 减少用户数
// 相同用户数

// 新增: 昨日没发言的用户
// 减少: 昨日用户数-相同用户数
// 相同: 昨日发言了的用户
// 来一个人就对比昨天有没有发言
async function setUserStats(self_id, user_id) {
  if (!config.userStats) return
  const user = userStats[self_id]
  const today = user[user.today]
  // 今天刚发言
  if (!today[user_id]) {
    // 昨天发言了
    if (user[user.yesterday][user_id]) {
      today.stats.invariant_user_count++
      today.stats.decrease_user_count--
      if (today.stats.decrease_user_count < 0) {
        today.stats.decrease_user_count = 0
      }
    }
    // 昨天没发言
    else {
      today.stats.increase_user_count++
    }
    today[user_id] = 0
  }
  today[user_id]++
  await user.db.put(user.today, { ...user, db: undefined })
}

async function initUserStats(self_id) {
  const path = join(process.cwd(), 'plugins', 'QQBot-Plugin', 'db', self_id)
  const db = new Level(path, { valueEncoding: "json" })
  await db.open()
  const user = {
    today: getDate(),
    yesterday: getDate(-1),
    db
  }
  for await (const [key, value] of db.iterator()) {
    try {
      // 删除一天前的数据
      if (key != user.today || key != user.yesterday) {
        await db.del(key)
        continue
      }
      user[key] = value
    } catch (error) { }
  }
  if (!user[user.today]) {
    user[user.today] = {}
  }
  if (!user[user.yesterday]) {
    user[user.yesterday] = {}
  }
  if (!user[user.today].stats) {
    user[user.today].stats = {
      increase_user_count: 0, // 增加用户数
      decrease_user_count: Object.keys(user[user.yesterday]).length, // 减少用户数
      invariant_user_count: 0,// 相同用户数
    }
  }
  userStats[self_id] = user
}

// 硬核
const numToChinese = {
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九', 10: '十',
  11: '十一', 12: '十二', 13: '十三', 14: '十四', 15: '十五',
  16: '十六', 17: '十七', 18: '十八', 19: '十九', 20: '二十',
  21: '二十一', 22: '二十二', 23: '二十三', 24: '二十四', 25: '二十五',
  26: '二十六', 27: '二十七', 28: '二十八', 29: '二十九', 30: '三十'
}

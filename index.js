import _ from 'lodash'
import fs from 'node:fs'
import axios from 'axios'
import { join } from 'node:path'
import imageSize from 'image-size'
import { randomUUID, randomBytes } from 'node:crypto'
import { encode as encodeSilk } from 'silk-wasm'
import {
  Dau,
  importJS,
  Runtime,
  Handler,
  config,
  configSave,
  refConfig,
  splitMarkDownTemplate,
  getMustacheTemplating,
  WebSocket,
  runServer,
  setUinMap
} from './Model/index.js'

const startTime = new Date()
logger.info(logger.yellow('- 正在加载 QQBot 适配器插件'))

const markdown_template = await importJS('Model/template/markdownTemplate.js', 'default')

const adapter = new class QQBotAdapter {
  constructor () {
    this.id = 'QQBot'
    this.name = 'QQBot'
    this.path = 'data/QQBot/'
    this.version = 'qq-group-bot v11.45.14'

    this.sep = config.sep || ((process.platform == 'win32') && '') || ':'
  }

  async request (method, url, options = {}) {
    const res = await axios.request({
      method,
      url,
      baseURL: 'https://api.sgroup.qq.com/',
      timeout: config.bot.timeout,
      ...options
    })
    return res.data
  }

  async makeMedia (data, file_type, file_data) {
    const target = data.group_id ? `groups/${data.group_id}` : `users/${data.user_id}`
    const info = {}
    if (typeof file_data == 'string' && file_data.startsWith('http')) {
      info.url = file_data
    } else {
      const buffer = await Bot.Buffer(file_data)
      info.file_data = buffer.toString('base64')
    }
    file_type = Number(file_type) || ['image', 'video', 'record'].indexOf(file_type) + 1
    return await data.bot.request('post', `/v2/${target}/files`, {
      data: {
        file_type,
        ...info,
        srv_send_msg: false
      }
    })
  }

  async makeRecord (file) {
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
    return file
  }

  async makeBotImage (file) {
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

  async makeMarkdownImage (data, file, summary = '图片') {
    const buffer = await Bot.Buffer(file)
    const image =
      await this.makeBotImage(buffer) ||
      { url: await Bot.fileToUrl(file) }

    if (!image.width || !image.height) {
      try {
        const size = imageSize(buffer)
        image.width = size.width
        image.height = size.height
      } catch (err) {
        Bot.makeLog('error', ['图片分辨率检测错误', file, err], data.self_id)
      }
    }

    image.width = Math.floor(image.width * config.markdownImgScale)
    image.height = Math.floor(image.height * config.markdownImgScale)

    return {
      des: `![${summary} #${image.width || 0}px #${image.height || 0}px]`,
      url: `(${image.url})`
    }
  }

  makeButton (data, button) {
    const msg = {
      id: randomUUID(),
      render_data: {
        label: button.text,
        visited_label: button.clicked_text,
        style: button.style ?? 1,
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
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.callback,
        enter: true,
        ...button.QQBot?.action
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
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this.sep}`, ''))
        }
      }
    }
    return msg
  }

  makeButtons (data, button_square) {
    const rows = []
    for (const button_row of button_square) {
      const buttons = []
      for (let button of button_row) {
        button = this.makeButton(data, button)
        if (button) buttons.push(button)
      }
      if (buttons.length) { rows.push({ buttons }) }
    }
    return rows
  }

  // TODO
  async makeRawMarkdownMsg (data, msg) {
    const messages = []
    const button = []
    let content = ''
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
        case 'video':
        case 'face':
        case 'ark':
        case 'embed':
          messages.push([i])
          break
        case 'file':
          if (i.file) i.file = await Bot.fileToUrl(i.file, i.type)
          content += await this.makeMarkdownText(`文件：${i.file}`)
          break
        case 'at':
          if (i.qq == 'all') { content += '@everyone' } else { content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, '')}>` }
          break
        case 'text':
          content += await this.makeMarkdownText(i.text)
          break
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary)
          content += `${des}${url}`
          break
        } case 'markdown':
          if (typeof i.data == 'object') messages.push([{ type: 'markdown', ...i.data }])
          else content += i.data
          break
        case 'button':
          button.push(...this.makeButtons(data, i.data))
          break
        case 'reply':
          if (i.id.startsWith('event_')) {
            reply = { type: 'reply', event_id: i.id.replace(/^event_/, '') }
          } else {
            reply = i
          }
          continue
        case 'node':
          for (const { message } of i.data) { messages.push(...(await this.makeRawMarkdownMsg(data, message))) }
          continue
        case 'raw':
          messages.push(Array.isArray(i.data) ? i.data : [i.data])
          break
        default:
          content += await this.makeMarkdownText(JSON.stringify(i))
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

  makeMarkdownText (text) {
    return text.replace(/\n/g, '\r').replace(/@/g, '@​').replace(/\.([A-Za-z]{2})/g, '. $1')
  }

  makeMarkdownTemplate (data, template) {
    let keys; let custom_template_id; let params = []; let index = 0; let type = 0
    const result = []
    if (markdown_template) {
      custom_template_id = markdown_template.custom_template_id
      params = _.cloneDeep(markdown_template.params)
      type = 1
    } else {
      const custom = config.customMD?.[data.self_id]
      custom_template_id = custom?.custom_template_id || config.markdown[data.self_id]
      keys = _.cloneDeep(custom?.keys) || config.markdown.template.split('')
    }
    for (const temp of template) {
      if (!temp.length) continue

      for (const i of splitMarkDownTemplate(temp)) {
        if (index == (type == 1 ? markdown_template.params.length : keys.length)) {
          result.push({
            markdown: {
              custom_template_id,
              params: _.cloneDeep(params)
            }
          })
          params = type == 1 ? _.cloneDeep(markdown_template.params) : []
          index = 0
        }

        if (type == 1) {
          params[index].values = [i]
        } else {
          params.push({
            key: keys[index],
            values: [i]
          })
        }
        index++
      }
    }

    if (config.mdSuffix?.[data.self_id]) {
      if (!params.some(p => config.mdSuffix[data.self_id].some(c => (c.key === p.key && p.values[0] !== '\u200B')))) {
        for (const i of config.mdSuffix[data.self_id]) {
          if (data.group_id) data.group = data.bot.pickGroup(data.group_id)
          if (data.user_id) data.friend = data.bot.pickFriend(data.user_id)
          if (data.user_id && data.group_id) data.member = data.bot.pickMember(data.group_id, data.user_id)
          const value = getMustacheTemplating(i.values[0], { e: data })
          params.push({ key: i.key, values: [value] })
        }
      }
    }

    if (params.length) {
      result.push({
        markdown: {
          custom_template_id,
          params
        }
      })
    }

    sult
    return re
  }

  async makeMarkdownMsg (data, msg) {
    const button = []
    let template = []
    let content = ''
    const reply = {}
    const length = markdown_template?.params?.length || config.customMD?.[data.self_id]?.keys?.length || config.markdown.template.length

    const params = []

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') i = { ...i }
      else i = { type: 'text', text: i }

      switch (i.type) {
        case 'record':
          i.file = await this.makeRecord(i.file)
        case 'video':{
          const media = await this.makeMedia(data, i.type, i.file)
          params.push({
            msg_type: 7,
            media
          })
          break
        }
        case 'face':
          continue
        case 'ark':
          delete i.type
          params.push({
            msg_type: 3,
            ark: i
          })
          break
        // TODO
        case 'embed':
          // messages.push([i])
          continue
        // TODO
        case 'file':
          // if (i.file) i.file = await Bot.fileToUrl(i.file, i, i.type)
          // button.push(...this.makeButtons(data, [[{ text: i.name || i.file, link: i.file }]]))
          // content += '[文件(请点击按钮查看)]'
          continue
        case 'at':
          // TODO: 目前还能用
          if (i.qq == 'all') content += '@everyone'
          else {
            content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, '')}>`
          }
          break
        case 'text':
          content += this.makeMarkdownText(i.text)
          break
        case 'node':
          if (Handler.has('ws.tool.toImg') && config.toImg) {
            const getButton = data => {
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
            let result = btn.reduce((acc, cur) => {
              const duplicate = acc.find(obj => obj.text === cur.text && obj.callback === cur.callback && obj.input === cur.input && obj.link === cur.link)
              if (!duplicate) return acc.concat([cur])
              else return acc
            }, [])

            const e = {
              reply: (msg) => {
                i = msg
              },
              user_id: data.bot.uin,
              nickname: data.bot.nickname
            }

            e.runtime = new Runtime(e)
            i.data.cfg = { retType: 'msgId', returnID: true }
            let { wsids } = await Handler.call('ws.tool.toImg', e, i.data)

            if (!result.length && data.wsids && data.wsids?.fnc) {
              wsids = wsids.map((id, k) => ({ text: `${data.wsids.text}${k}`, callback: `#ws查看${id}` }))
              result = _.chunk(_.tail(wsids), data.wsids.col)
            }

            for (const b of result) {
              button.push(...this.makeButtons(data, b.data ? b.data : [b]))
            }
          } else {
            for (const { message } of i.data) {
              sh(...(await this.makeMarkdownMsg(data, message)))
              params.pu
            }
            continue
          }
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary)
          const limit = template.length % (length - 1)

          // 图片数量超过模板长度时
          if (template.length && !limit) {
            if (content) template.push(content)
            template.push(des)
          } else template.push(content + des)

          content = url
          break
        }
        case 'markdown':
          if (typeof i.data == 'object') {
            params.push({
              msg_type: 2,
              markdown: i.data,
              msg_seq: randomBytes(2).readUint16BE()
            })
          } else {
            content += i.data
          }
          continue
        case 'button':
          button.push(...this.makeButtons(data, i.data))
          continue
        case 'reply':
          if (i.id.startsWith('event_')) {
            Object.assign(reply, { event_id: i.id.replace(/^event_/, '') })
          } else {
            Object.assign(reply, { msg_id: i.id })
          }
          continue
        case 'raw':
          params.push({
            msg_seq: randomBytes(2).readUint16BE(),
            ...i.data
          })
          continue
        default:
          content += this.makeMarkdownText(JSON.stringify(i))
      }
    }

    if (content) template.push(content)
    if (template.length > length) {
      const templates = _(template).chunk(length).map(v => this.makeMarkdownTemplate(data, v)).value().flat()
      params.push(...templates)
    } else if (template.length) {
      const tmp = this.makeMarkdownTemplate(data, template)
      params.push(...tmp)
    }

    if (template.length && button.length < 5 && config.btnSuffix[data.self_id]) {
      let { position, values } = config.btnSuffix[data.self_id]
      position = +position - 1
      if (position > button.length) {
        position = button.length
      }
      const btn = values.filter(i => {
        if (i.show) {
          switch (i.show.type) {
            case 'random':
              if (i.show.data <= _.random(1, 100)) return false
              break
            default:
              break
          }
        }
        return true
      })
      button.splice(position, 0, ...this.makeButtons(data, [btn]))
    }

    if (button.length) {
      for (const i of params) {
        if (i.markdown) {
          i.keyboard = {
            bot_appid: data.bot.info.appid,
            content: {
              rows: button.splice(0, 5)
            }
          }
        }
        if (!button.length) break
      }
      while (button.length) {
        params.push({
          markdown: this.makeMarkdownTemplate(data, [' '])[0],
          keyboard: {
            bot_appid: data.bot.info.appid,
            content: {
              rows: button.splice(0, 5)
            }
          }
        })
      }
    }
    for (const i of params) {
      Object.assign(i, {
        content: i.content ?? '',
        msg_type: i.msg_type ?? 2,
        msg_seq: randomBytes(2).readUint16BE(),
        ...reply
      })
    }
    return params
  }

  async makeMsg (data, msg) {
    let reply

    const params = []

    let param = {}

    const resetParam = () => {
      param = {
        content: '',
        msg_type: 0,
        msg_seq: randomBytes(2).readUint16BE()
      }
    }

    resetParam()

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'face':
        case 'at':
          // i.qq = i.qq?.replace?.(`${data.self_id}${this.sep}`, "")
          continue
        case 'text':
          param.content += i.text
          break
        case 'ark':
          delete i.type
          params.push({
            msg_type: 3,
            ark: i,
            msg_seq: randomBytes(2).readUint16BE()
          })
          continue
        // TODO
        case 'embed':
          continue
        case 'record':
          i.file = await this.makeRecord(i.file)
        case 'video':
        case 'image': {
          if (param.media) {
            params.push(param)
            resetParam()
          }
          const media = await this.makeMedia(data, i.type, i.file)
          param.media = media
          param.msg_type = 7
          break
        }
        case 'file':
          // TODO: 会暴露服务器ip
          // if (i.file) i.file = await Bot.fileToUrl(i.file, i, i.type)
          // i = { type: 'text', text: `文件：${i.file}` }
          // break
          continue
        case 'reply':
          if (i.id.startsWith('event_')) {
            reply = { event_id: i.id.replace(/^event_/, '') }
          } else {
            reply = { msg_id: i.id }
          }
          continue
        case 'markdown':
          if (typeof i.data == 'object') {
            params.push({
              msg_type: 2,
              markdown: i.data,
              msg_seq: randomBytes(2).readUint16BE()
            })
          } else {
            params.push({
              msg_type: 2,
              markdown: { content: i.data },
              msg_seq: randomBytes(2).readUint16BE()
            })
          }
          break
        case 'button':
          continue
        case 'node':
          if (Handler.has('ws.tool.toImg') && config.toImg) {
            const e = {
              reply: (msg) => {
                i = msg
              },
              user_id: data.bot.uin,
              nickname: data.bot.nickname
            }
            e.runtime = new Runtime(e)
            await Handler.call('ws.tool.toImg', e, i.data)
            // i.file = await Bot.fileToUrl(i.file)
            if (param.media) {
              params.push(param)
              resetParam()
            }
            const media = await this.makeMedia(data, i.type, i.file)
            param.media = media
            param.msg_type = 7
          } else {
            for (const { message } of i.data) {
              params.push(...(await this.makeMsg(data, message)))
            }
          }
          break
        case 'raw':
          params.push({
            msg_seq: randomBytes(2).readUint16BE(),
            ...i.data
          })
          continue
        default:
          param.content += JSON.stringify(i)
      }

      if (param.content) {
        param.content = this.makeMarkdownText(param.content)
      }

      // if (i.type !== 'node') message.push(i)
    }

    if (param.content || param.media) {
      params.push(param)
    }

    if (reply) {
      for (const i of params) {
        Object.assign(i, reply)
      }
    }
    return params
  }

  async sendMsg (data, msg, msg_id) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          Bot.makeLog('debug', ['发送消息', i], data.self_id)
          const send = async param => {
            const target = data.group_id ? `groups/${data.group_id}` : `users/${data.user_id}`
            const reply = msg_id?.startsWith('event_') ? { event_id: msg_id.replace(/^event_/, '') } : { msg_id }
            return await data.bot.request('post', `v2/${target}/messages`, {
              data: {
                ...param,
                ...reply
              }
            })
          }
          const ret = await send(i)
          Bot.makeLog('debug', ['发送消息返回', ret], data.self_id)

          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
          Bot[data.self_id].dau.setDau('send_msg', data)
        } catch (err) {
          // Bot.makeLog('error', ['发送消息错误', i, err], data.self_id)
          logger.error(data.self_id, '发送消息错误', i, err)
          rets.error.push(err)
          return false
        }
      }
    }

    // TODO: 等个有缘人提供有md和按钮权限的账号
    if ((config.markdown[data.self_id] || (data.toQQBotMD === true && config.customMD[data.self_id])) && data.toQQBotMD !== false) {
      // if (config.markdown[data.self_id] == 'raw') {
      //   msgs = await this.makeRawMarkdownMsg(data, msg)
      // } else {
      //   msgs = await this.makeMarkdownMsg(data, msg)
      // }
      msgs = await this.makeMarkdownMsg(data, msg)
    } else {
      msgs = await this.makeMsg(data, msg)
    }

    if (await sendMsg() === false) {
      msgs = await this.makeMsg(data, msg)
      await sendMsg()
    }

    if (Array.isArray(data._ret_id)) { data._ret_id.push(...rets.message_id) }
    return rets
  }

  sendFriendMsg (data, msg, msg_id) {
    return this.sendMsg(data, msg, msg_id)
  }

  async sendGroupMsg (data, msg, msg_id) {
    if (Handler.has('QQBot.group.sendMsg')) {
      const res = await Handler.call(
        'QQBot.group.sendMsg',
        data,
        {
          self_id: data.self_id,
          group_id: `${data.self_id}${this.sep}${data.group_id}`,
          raw_group_id: data.group_id,
          user_id: data.user_id,
          msg,
          msg_id
        }
      )
      if (res !== false) {
        return res
      }
    }
    return this.sendMsg(data, msg, msg_id)
  }

  async recallMsg (data, recall, message_id) {
    if (!Array.isArray(message_id)) message_id = [message_id]
    const msgs = []
    for (const i of message_id) {
      try {
        msgs.push(await recall(i))
      } catch (err) {
        Bot.makeLog('debug', ['撤回消息错误', i, err], data.self_id)
        msgs.push(false)
      }
    }
    return msgs
  }

  recallFriendMsg (data, message_id) {
    Bot.makeLog('info', `撤回好友消息：[${data.user_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallFriendMessage(data.user_id, i), message_id)
  }

  recallGroupMsg (data, message_id) {
    Bot.makeLog('info', `撤回群消息：[${data.group_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallGroupMessage(data.group_id, i), message_id)
  }

  pickFriend (id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, '')
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      recallMsg: message_id => this.recallFriendMsg(i, message_id),
      getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`
    }
  }

  pickMember (id, group_id, user_id) {
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
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace?.(`${id}${this.sep}`, '') || group_id
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
      recallMsg: message_id => this.recallGroupMsg(i, message_id),
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

  async makeMessage (id, event) {
    const d = event.d
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: d.id,
      sender: {
        user_id: `${id}${this.sep}${d.author.id}`
      },
      get user_id () { return this.sender.user_id },
      message: [],
      raw_message: ''
    }

    if (d.content) {
      data.message.push({ type: 'text', text: d.content })
      data.raw_message += d.content
    }

    if (d.attachments) {
      for (const i of d.attachments) {
        data.message.push({
          type: 'image',
          ...i
        })
        data.raw_message += `{image:${i.filename.split('.').shift()}}`
      }
    }

    switch (event.t) {
      case 'C2C_MESSAGE_CREATE':
        Bot.makeLog('info', `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
        data.message_type = 'private'
        data.sub_type = 'friend'
        data.reply = msg => this.sendFriendMsg({
          ...data, user_id: d.author.id
        }, msg, data.message_id)
        this.setFriendMap(data)
        break
      case 'GROUP_AT_MESSAGE_CREATE': {
        data.group_id = `${data.self_id}${this.sep}${d.group_id}`

        // 自定义消息过滤前台日志防刷屏(自欺欺人大法)
        const filterLog = config.filterLog?.[data.self_id] || []
        const logStat = filterLog.includes(_.trim(data.raw_message)) ? 'debug' : 'info'
        Bot.makeLog(logStat, `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)

        data.reply = msg => this.sendGroupMsg({
          ...data, group_id: d.group_id
        }, msg, data.message_id)
        this.setGroupMap(data)
        // TODO: 可以添加config是否添加atbot
        // data.message.unshift({ type: "at", qq: data.self_id })
        break
      }
      default:
        Bot.makeLog('warn', ['未知消息', event], id)
        return
    }

    data.bot.stat.recv_msg_cnt++
    Bot[data.self_id].dau.setDau('receive_msg', data)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  makeNotice (id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: 'notice',
      message_id: `event_${event.id}`
    }

    const openid = event.d.op_member_openid || event.d.openid || event.d.group_member_openid || event.d.author.union_openid

    const user_id = `${id}${this.sep}${openid}`
    const group_id = `${id}${this.sep}${event.d.group_openid}`

    switch (event.t) {
      case 'GROUP_ADD_ROBOT': {
        Object.assign(data, {
          notice_type: 'group',
          sub_type: 'increase',
          user_id: id,
          group_id
        })
        Bot.makeLog('info', `机器人被邀请加入群聊：${event.d.group_openid} 操作人：${openid}`, id)
        Bot[id].dau.setDau('group_increase', data)
        const path = join(process.cwd(), 'plugins', 'QQBot-Plugin', 'Model', 'template', 'groupIncreaseMsg.js')
        if (fs.existsSync(path)) {
          import(`file://${path}`).then(i => i.default).then(async i => {
            let msg
            if (typeof i === 'function') {
              msg = await i(`${data.self_id}${this.sep}${event.group_id}`, `${data.self_id}${this.sep}${data.user_id}`, data.self_id)
            } else {
              msg = i
            }
            if (msg?.length > 0) {
              this.sendMsg({ ...data, group_id: event.d.group_openid }, msg, data.message_id)
            }
          })
        }
        break
      }
      case 'GROUP_DEL_ROBOT':
        Object.assign(data, {
          notice_type: 'group',
          sub_type: 'decrease',
          user_id: id,
          operator_id: user_id,
          group_id
        })
        Bot.makeLog('info', `机器人被移出群聊：${event.d.group_openid} 操作人：${openid}`, id)
        Bot[id].dau.setDau('group_decrease', data)
        data.bot.gl.delete(group_id)
        break
      case 'GROUP_MSG_RECEIVE':
        Object.assign(data, {
          notice_type: 'group',
          sub_type: 'msg_receive',
          user_id,
          operator_id: user_id,
          group_id
        })
        Bot.makeLog('info', `打开群主动消息推送：${event.d.group_openid} 操作人: ${openid}`, id)
        break
      case 'GROUP_MSG_REJECT':
        Object.assign(data, {
          notice_type: 'group',
          sub_type: 'msg_reject',
          user_id,
          operator_id: user_id,
          group_id
        })
        Bot.makeLog('info', `关闭群主动消息推送：${event.d.group_openid} 操作人: ${openid}`, id)
        break
      case 'FRIEND_ADD':
        Object.assign(data, {
          notice_type: 'friend',
          sub_type: 'increase',
          user_id
        })
        Bot.makeLog('info', `好友增加：${openid}`, id)
        break
      case 'FRIEND_DEL':
        Object.assign(data, {
          notice_type: 'friend',
          sub_type: 'decrease',
          user_id
        })
        Bot.makeLog('info', `好友减少：${openid}`, id)
        data.bot.fl.delete(user_id)
        break
      case 'C2C_MSG_RECEIVE':
        Object.assign(data, {
          notice_type: 'friend',
          sub_type: 'msg_receive',
          user_id,
          operator_id: user_id
        })
        Bot.makeLog('info', `打开好友主动消息推送：${openid}`, id)
        break
      case 'C2C_MSG_REJECT':
        Object.assign(data, {
          notice_type: 'friend',
          sub_type: 'msg_reject',
          user_id,
          operator_id: user_id
        })
        Bot.makeLog('info', `关闭好友主动消息推送：${openid}`, id)
        break
      case 'INTERACTION_CREATE':
        if (event.d.type !== 11 || event.d.chat_type === 0) {
          return
        }
        if (event.d.chat_type === 1) {
          Object.assign(data, {
            notice_type: 'group',
            sub_type: 'interaction',
            user_id,
            group_id
          })
        } else {
          Object.assign(data, {
            notice_type: 'friend',
            sub_type: 'interaction',
            user_id
          })
        }
        Bot.makeLog('info', `点击消息按钮：${openid}`, id)
        break
    }

    Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
  }

  onMessage (id, event) {
    try {
      if (event.op !== 0) {
        return
      }
      switch (event.t) {
        case 'GROUP_AT_MESSAGE_CREATE':
        case 'C2C_MESSAGE_CREATE':
          this.makeMessage(id, event)
          break
        case 'GROUP_ADD_ROBOT':
        case 'GROUP_DEL_ROBOT':
        case 'GROUP_MSG_RECEIVE':
        case 'GROUP_MSG_REJECT':
        case 'FRIEND_ADD':
        case 'FRIEND_DEL':
        case 'C2C_MSG_REJECT':
        case 'C2C_MSG_RECEIVE':
        case 'INTERACTION_CREATE':
          this.makeNotice(id, event)
          break
        default:
          break
      }
    } catch (error) {

    }
  }

  getFriendMap (id) {
    return Bot.getMap(`${this.path}${id}/Friend`)
  }

  getGroupMap (id) {
    return Bot.getMap(`${this.path}${id}/Group`)
  }

  getMemberMap (id) {
    return Bot.getMap(`${this.path}${id}/Member`)
  }

  async connect (token) {
    token = token.split(':')
    const id = token[0]

    const opts = {
      ...config.bot,
      appid: token[1],
      token: token[2],
      secret: token[3]
    }

    setUinMap(opts.appid, id)

    const refreshAccessToken = async () => {
      const res = await this.request('post', 'app/getAppAccessToken', {
        baseURL: 'https://bots.qq.com/',
        data: {
          appId: opts.appid,
          clientSecret: opts.secret
        }
      })
      opts.accessToken = res.access_token
      setTimeout(refreshAccessToken, res.expires_in * 1000 - 30 * 1000)
    }

    await refreshAccessToken()

    const request = (method, url, options = {}) => {
      return this.request(method, url, {
        ...options,
        headers: {
          Authorization: `QQBot ${opts.accessToken}`
        }
      })
    }

    const BotInfo = await request('get', 'users/@me')

    Bot[id] = {
      adapter: this,

      uin: id,
      info: { id, ...BotInfo, appid: opts.appid },
      nickname: BotInfo.nickname,
      avatar: `https://q.qlogo.cn/g?b=qq&s=0&nk=${id}`,

      version: {
        id: this.id,
        name: this.name,
        version: this.version
      },
      stat: {
        start_time: Date.now() / 1000,
        recv_msg_cnt: 0
      },

      privacy: accessToken => {
        if (accessToken) {
          opts.accessToken = accessToken
        }
        return opts
      },
      request,

      pickFriend: user_id => this.pickFriend(id, user_id),
      get pickUser () { return this.pickFriend },
      getFriendMap () { return this.fl },
      fl: await this.getFriendMap(id),

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap () { return this.gl },
      gl: await this.getGroupMap(id),
      gml: await this.getMemberMap(id),

      dau: new Dau(id, this.sep),

      callback: {}
    }

    await Bot[id].dau.init()

    const transferWebSocket = config.webhook.ws[id]

    if (transferWebSocket) {
      Bot[id].ws = new WebSocket(
        this.onMessage.bind(this),
        id,
        transferWebSocket.url,
        transferWebSocket.reconn,
        transferWebSocket.max,
        transferWebSocket.ping
      )
    }

    Bot.makeLog('mark', `${this.name}(${this.id}) ${this.version} 已连接`, id)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async load () {
    this.fastify = await runServer(this.onMessage.bind(this))
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
  转图片: 'toImg',
  调用统计: 'callStats'
}

export class QQBotAdapter extends plugin {
  constructor () {
    super({
      name: 'QQBotAdapter',
      dsc: 'QQBot 适配器设置',
      event: 'message',
      rule: [
        {
          reg: /^#q+bot(帮助|help)$/i,
          fnc: 'help',
          permission: config.permission
        },
        {
          reg: /^#q+bot账号$/i,
          fnc: 'List',
          permission: config.permission
        },
        {
          reg: /^#q+bot设置[0-9]+:[0-9]+:.+:.+:[01]:[01]$/i,
          fnc: 'Token',
          permission: config.permission
        },
        {
          reg: /^#q+botm(ark)?d(own)?[0-9]+:/i,
          fnc: 'Markdown',
          permission: config.permission
        },
        {
          reg: new RegExp(`^#q+bot设置(${Object.keys(setMap).join('|')})\\s*(开启|关闭)$`, 'i'),
          fnc: 'Setting',
          permission: config.permission
        },
        {
          reg: /^#q+botdau/i,
          fnc: 'DAUStat',
          permission: config.permission
        },
        {
          reg: /^#q+bot调用统计$/i,
          fnc: 'callStat',
          permission: config.permission
        },
        {
          reg: /^#q+bot刷新co?n?fi?g$/i,
          fnc: 'refConfig',
          permission: config.permission
        },
        {
          reg: /^#q+bot(添加|删除)过滤日志/i,
          fnc: 'filterLog',
          permission: config.permission
        },
        {
          reg: /^#q+bot一键群发$/i,
          fnc: 'oneKeySendGroupMsg',
          permission: config.permission
        }
      ]
    })
  }

  help () {
    this.reply([' ', segment.button(
      [
        { text: 'dau', callback: '#QQBotdau' },
        { text: 'daupro', callback: '#QQBotdaupro' },
        { text: '调用统计', callback: '#QQBot调用统计' },
        { text: '用户统计', callback: '#QQBot用户统计' }
      ],
      [
        { text: `${config.toCallback ? '关闭' : '开启'}按钮回调`, callback: `#QQBot设置按钮回调${config.toCallback ? '关闭' : '开启'}` },
        { text: `${config.callStats ? '关闭' : '开启'}调用统计`, callback: `#QQBot设置调用统计${config.callStats ? '关闭' : '开启'}` }
      ]
    )])
  }

  refConfig () {
    refConfig()
  }

  List () {
    this.reply(`共${config.token.length}个账号：\n${config.token.join('\n')}`, true)
  }

  async Token () {
    const token = this.e.msg.replace(/^#q+bot设置/i, '').trim()
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

  async Markdown () {
    let token = this.e.msg.replace(/^#q+botm(ark)?d(own)?/i, '').trim().split(':')
    const bot_id = token.shift()
    token = token.join(':')
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    await configSave()
  }

  async Setting () {
    const reg = /^#q+bot设置(.+)\s*(开启|关闭)$/i
    const regRet = reg.exec(this.e.msg)
    const state = regRet[2] == '开启'
    config[setMap[regRet[1]]] = state
    this.reply('设置成功,已' + (state ? '开启' : '关闭'), true)
    await configSave()
  }

  async DAUStat () {
    const pro = this.e.msg.includes('pro')
    const uin = this.e.msg.replace(/^#q+botdau(pro)?/i, '') || this.e.self_id
    const dau = Bot[uin]?.dau
    if (!dau) return false
    const msg = await dau.getDauStatsMsg(this.e, pro)
    if (msg.length) this.reply(msg, true)
  }

  async callStat () {
    if (!config.callStats) return false
    const dau = this.e.bot.dau
    if (!dau) return false
    const msg = dau.getCallStatsMsg(this.e)
    if (msg.length) this.reply(msg, true)
  }

  // 自欺欺人大法
  async filterLog () {
    const match = /^#q+bot(添加|删除)过滤日志(.*)/i.exec(this.e.msg)
    let msg = _.trim(match[2]) || ''
    if (!msg) return false

    let isAdd = match[1] === '添加'
    const filterLog = config.filterLog[this.e.self_id] || []
    const has = filterLog.includes(msg)

    if (has && isAdd) return false
    else if (!has && !isAdd) return false
    else if (!has && isAdd) {
      filterLog.push(msg)
      msg = `【${msg}】添加成功， info日志已过滤该消息`
    } else {
      _.pull(filterLog, msg)
      msg = `【${msg}】删除成功， info日志已恢复打印该消息`
    }
    config.filterLog[this.e.self_id] = filterLog
    await configSave()
    this.reply(msg, true)
  }

  async oneKeySendGroupMsg () {
    if (this.e.adapter_name !== 'QQBot') return false
    const msg = await importJS('Model/template/oneKeySendGroupMsg.js', 'default')
    if (msg === false) {
      this.reply('请先设置模版哦', true)
    } else {
      const getMsg = typeof msg === 'function' ? msg : () => msg
      const errGroupList = []
      for (const key of this.e.bot.gl.keys()) {
        if (key === 'total') continue
        const sendMsg = await getMsg(key)
        if (!sendMsg?.length) continue
        const sendRet = await this.e.bot.pickGroup(key).sendMsg(sendMsg)
        if (sendRet.error.length) {
          for (const i of sendRet.error) {
            if (i.message.includes('机器人非群成员')) {
              errGroupList.push(key)
              break
            }
          }
        }
      }
      if (errGroupList.length) await this.e.bot.dau.deleteNotExistGroup(errGroupList)
      logger.info(logger.green(`QQBot ${this.e.self_id} 群消息一键发送完成，共${this.e.bot.gl.size}个群，失败${errGroupList.length}个`))
    }
  }
}

const endTime = new Date()
logger.info(logger.green(`- QQBot 适配器插件 加载完成! 耗时：${endTime - startTime}ms`))

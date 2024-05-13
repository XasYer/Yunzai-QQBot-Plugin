import _ from 'lodash'
import YAML from 'yaml'
import fs from 'node:fs'
import QRCode from 'qrcode'
import { join } from 'node:path'
import imageSize from 'image-size'
import { randomUUID } from 'node:crypto'
import { Bot as QQBot } from 'qq-group-bot'
import { encode as encodeSilk } from 'silk-wasm'
import {
  Dau,
  decodePb,
  importJS,
  Runtime,
  Handler,
  makeConfig,
  splitMarkDownTemplate,
  getMustacheTemplating
} from './Model/index.js'

const startTime = new Date()
logger.info(logger.yellow('- 正在加载 QQBot 适配器插件'))

const userIdCache = {}
const markdown_template = await importJS('Model/template/markdownTemplate.js', 'default')
const TmplPkg = await importJS('templates/index.js')

let { config, configSave } = await makeConfig('QQBot', {
  tips: '',
  permission: 'master',
  toQRCode: true,
  toCallback: true,
  toBotUpload: true,
  hideGuildRecall: false,
  toQQUin: false,
  toImg: true,
  callStats: false,
  userStats: false,
  markdown: {
    template: 'abcdefghij'
  },
  customMD: {},
  mdSuffix: {},
  btnSuffix: {},
  filterLog: {},
  simplifiedSdkLog: false,
  markdownImgScale: 1.0,
  sep: '',
  // dau: {
  //   enable: true,
  //   user_count: true,  // 上行消息人数
  //   group_count: true, // 上行消息群数
  //   msg_count: true,      // 上行消息量
  //   send_count: true,     // 下行消息量
  //   all_user_count: true, // 所有用户数
  //   all_group_count: true, // 所有群组数
  //   group_increase_count: true, // 新增群数量
  //   group_decrease_count: true, // 减少群数量
  // 新增用户数量
  // 消息数量最多的用户
  // 消息数量最多的群聊
  // 昨日数据
  // 平均数据
  // },
  bot: {
    sandbox: false,
    maxRetry: Infinity,
    timeout: 30000
  },
  token: []
}, {
  tips: [
    '欢迎使用 TRSS-Yunzai QQBot Plugin ! 作者：时雨🌌星空 & 小叶',
    '参考：https://github.com/XasYer/Yunzai-QQBot-Plugin'
  ]
})

const adapter = new class QQBotAdapter {
  constructor () {
    this.id = 'QQBot'
    this.name = 'QQBot'
    this.path = 'data/QQBot/'
    this.version = 'qq-group-bot v11.45.14'

    if (typeof config.toQRCode == 'boolean') {
      this.toQRCodeRegExp = config.toQRCode ? /(?<!\[(.*?)\]\()https?:\/\/[-\w_]+(\.[-\w_]+)+([-\w.,@?^=%&:/~+#]*[-\w@?^=%&/~+#])?/g : false
    } else {
      this.toQRCodeRegExp = new RegExp(config.toQRCode, 'g')
    }

    this.sep = config.sep || ((process.platform == 'win32') && '') || ':'
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

  async makeQRCode (data) {
    return (await QRCode.toDataURL(data)).replace('data:image/png;base64,', 'base64://')
  }

  async makeRawMarkdownText (data, baseUrl, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) {
      for (const url of match) {
        button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
        const img = await this.makeMarkdownImage(data, baseUrl, await this.makeQRCode(url), '二维码')
        text = text.replace(url, `${img.des}${img.url}`)
      }
    }
    return text.replace(/@/g, '@​')
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

  async uploadImage (data, baseUrl, file) {
    try {
      const res = await data.bot.sdk.request.post(`/v2/${baseUrl}/files`, {
        file_type: 1,
        file_data: file.toString('base64')
      })
      const proto = decodePb(Buffer.from(res.data.file_info, 'base64'))
      return {
        url: `http://multimedia.nt.qq.com${String(proto[1][3][baseUrl.startsWith('users/') ? 29 : 34][30]).replace(/_/g, '%5F')}`,
        width: Number(proto[1][3][22]),
        height: Number(proto[1][3][23])
      }
    } catch (err) {
      Bot.makeLog('error', ['图片上传错误', file, err], data.self_id)
    }
  }

  async makeMarkdownImage (data, baseUrl, file, summary = '图片') {
    const buffer = await Bot.Buffer(file)
    const image = // await this.uploadImage(data, baseUrl, buffer) ||
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

  makeButtons (data, button_square) {
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

  async makeRawMarkdownMsg (data, baseUrl, msg) {
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
          content += await this.makeRawMarkdownText(data, baseUrl, `文件：${i.file}`, button)
          break
        case 'at':
          if (i.qq == 'all') { content += '@everyone' } else { content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, '')}>` }
          break
        case 'text':
          content += await this.makeRawMarkdownText(data, baseUrl, i.text, button)
          break
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(data, baseUrl, i.file, i.summary)
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
          reply = i
          continue
        case 'node':
          for (const { message } of i.data) { messages.push(...(await this.makeRawMarkdownMsg(data, baseUrl, message))) }
          continue
        case 'raw':
          messages.push(Array.isArray(i.data) ? i.data : [i.data])
          break
        default:
          content += await this.makeRawMarkdownText(data, baseUrl, JSON.stringify(i), button)
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

  makeMarkdownText (data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) {
      for (const url of match) {
        button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
        text = text.replace(url, '[链接(请点击按钮查看)]')
      }
    }
    return text.replace(/\n/g, '\r').replace(/@/g, '@​')
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
            type: 'markdown',
            custom_template_id,
            params: _.cloneDeep(params)
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
        type: 'markdown',
        custom_template_id,
        params
      })
    }

    return result
  }

  async makeMarkdownMsg (data, baseUrl, msg) {
    const messages = []
    const button = []
    let template = []
    let content = ''
    let reply
    const length = markdown_template?.params?.length || config.customMD?.[data.self_id]?.keys?.length || config.markdown.template.length

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') i = { ...i }
      else i = { type: 'text', text: i }

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
          if (i.file) i.file = await Bot.fileToUrl(i.file, i, i.type)
          button.push(...this.makeButtons(data, [[{ text: i.name || i.file, link: i.file }]]))
          content += '[文件(请点击按钮查看)]'
          break
        case 'at':
          if (i.qq == 'all') content += '@everyone'
          else {
            if (config.toQQUin && userIdCache[i.qq]) i.qq = userIdCache[i.qq]
            content += `<@${i.qq?.replace?.(`${data.self_id}${this.sep}`, '')}>`
          }
          break
        case 'text':
          content += this.makeMarkdownText(data, i.text, button)
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
          } else if (TmplPkg && TmplPkg?.nodeMsg) {
            messages.push(...(await this.makeMarkdownMsg(data, baseUrl, TmplPkg.nodeMsg(i.data))))
            continue
          } else {
            for (const { message } of i.data) {
              messages.push(...(await this.makeMarkdownMsg(data, baseUrl, message)))
            }
            continue
          }
        case 'image': {
          const { des, url } = await this.makeMarkdownImage(data, baseUrl, i.file, i.summary)
          const limit = template.length % (length - 1)

          // 图片数量超过模板长度时
          if (template.length && !limit) {
            if (content) template.push(content)
            template.push(des)
          } else template.push(content + des)

          content = url
          break
        } case 'markdown':
          if (typeof i.data == 'object') messages.push([{ type: 'markdown', ...i.data }])
          else content += i.data
          break
        case 'button':
          button.push(...this.makeButtons(data, i.data))
          break
        case 'reply':
          reply = i
          continue
        case 'raw':
          messages.push(Array.isArray(i.data) ? i.data : [i.data])
          break
        case 'custom':
          template.push(...i.data)
          break
        default:
          content += this.makeMarkdownText(data, JSON.stringify(i), button)
      }
    }

    if (content) template.push(content)
    if (template.length > length) {
      const templates = _(template).chunk(length).map(v => this.makeMarkdownTemplate(data, v)).value()
      messages.push(...templates)
    } else if (template.length) {
      const tmp = this.makeMarkdownTemplate(data, template)
      if (tmp.length > 1) {
        messages.push(...tmp.map(i => ([i])))
      } else {
        messages.push(tmp)
      }
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
      for (const i of messages) {
        if (i[0].type == 'markdown') i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          ...this.makeMarkdownTemplate(data, [' ']),
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

  async makeMsg (data, msg) {
    const sendType = ['audio', 'image', 'video', 'file']
    const messages = []
    const button = []
    let message = []
    let reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'at':
          // if (config.toQQUin && userIdCache[user_id]) {
          //   i.qq = userIdCache[user_id]
          // }
          // i.qq = i.qq?.replace?.(`${data.self_id}${this.sep}`, "")
          continue
        case 'text':
        case 'face':
        case 'ark':
        case 'embed':
          break
        case 'record':
          i.type = 'audio'
          i.file = await this.makeRecord(i.file)
        case 'video':
        case 'image':
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
            for (const { message } of i.data) {
              messages.push(...(await this.makeMsg(data, message)))
            }
          }
          break
        case 'raw':
          if (Array.isArray(i.data)) {
            messages.push(i.data)
            continue
          }
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

  async sendMsg (data, baseUrl, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          Bot.makeLog('debug', ['发送消息', i], data.self_id)
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

    if (TmplPkg && TmplPkg?.Button && !data.toQQBotMD) {
      let fncName = /\[.*?\((\S+)\)\]/.exec(data.logFnc)[1]
      const Btn = TmplPkg.Button[fncName]

      if (msg.type === 'node') data.wsids = { toImg: config.toImg }

      let res
      if (Btn) res = Btn(data, msg)

      if (res?.nodeMsg) {
        data.toQQBotMD = true
        data.wsids = {
          text: res.nodeMsg,
          fnc: fncName,
          col: res.col
        }
      } else if (res) {
        data.toQQBotMD = true
        res = segment.button(...res)
        msg = _.castArray(msg)

        let _btn = msg.findIndex(b => b.type === 'button')
        if (_btn === -1) msg.push(res)
        else msg[_btn] = res
      }
    }

    if ((config.markdown[data.self_id] || (data.toQQBotMD === true && config.customMD[data.self_id])) && data.toQQBotMD !== false) {
      if (config.markdown[data.self_id] == 'raw') msgs = await this.makeRawMarkdownMsg(data, baseUrl, msg)
      else msgs = await this.makeMarkdownMsg(data, baseUrl, msg)

      const [mds, btns] = _.partition(msgs[0], v => v.type === 'markdown')
      if (mds.length > 1) {
        for (const idx in mds) {
          msgs = mds[idx]
          if (idx === mds.length - 1) msgs.push(...btns)
          await sendMsg()
        }
        return rets
      }
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

  sendFriendMsg (data, msg, event) {
    return this.sendMsg(data, `users/${data.user_id}`, msg => data.bot.sdk.sendPrivateMessage(data.user_id, msg, event), msg)
  }

  sendGroupMsg (data, msg, event) {
    return this.sendMsg(data, `groups/${data.group_id}`, msg => data.bot.sdk.sendGroupMessage(data.group_id, msg, event), msg)
  }

  async makeGuildMsg (data, msg) {
    const messages = []
    let message = []
    let reply
    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i == 'object') { i = { ...i } } else { i = { type: 'text', text: i } }

      switch (i.type) {
        case 'at':
          i.user_id = i.qq?.replace?.(/^qg_/, '')
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
          if (Array.isArray(i.data)) {
            messages.push(i.data)
            continue
          }
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

  async sendGMsg (data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs) {
        try {
          Bot.makeLog('debug', ['发送消息', i], data.self_id)
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

    msgs = await this.makeGuildMsg(data, msg)
    if (await sendMsg() === false) {
      msgs = await this.makeGuildMsg(data, msg)
      await sendMsg()
    }
    return rets
  }

  async sendDirectMsg (data, msg, event) {
    if (!data.guild_id) {
      if (!data.src_guild_id) {
        Bot.makeLog('error', [`发送频道私聊消息失败：[${data.user_id}] 不存在来源频道信息`, msg], data.self_id)
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

  recallDirectMsg (data, message_id, hide = config.hideGuildRecall) {
    Bot.makeLog('info', `撤回${hide ? '并隐藏' : ''}频道私聊消息：[${data.guild_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallDirectMessage(data.guild_id, i, hide), message_id)
  }

  recallGuildMsg (data, message_id, hide = config.hideGuildRecall) {
    Bot.makeLog('info', `撤回${hide ? '并隐藏' : ''}频道消息：[${data.channel_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallGuildMessage(data.channel_id, i, hide), message_id)
  }

  sendGuildMsg (data, msg, event) {
    return this.sendGMsg(data, msg => data.bot.sdk.sendGuildMessage(data.channel_id, msg, event), msg)
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
      sendMsg: msg => this.sendFriendMsg(i, msg),
      recallMsg: message_id => this.recallFriendMsg(i, message_id),
      getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`
    }
  }

  pickMember (id, group_id, user_id) {
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

  pickGroup (id, group_id) {
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
      recallMsg: message_id => this.recallGroupMsg(i, message_id),
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
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide)
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
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide)
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
      sendMsg: msg => this.sendGuildMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallGuildMsg(i, message_id, hide),
      pickMember: user_id => this.pickGuildMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id)
    }
  }

  async makeFriendMessage (data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`
    }
    Bot.makeLog('info', `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendFriendMsg({
      ...data, user_id: event.sender.user_id
    }, msg, { id: data.message_id })
    await this.setFriendMap(data)
  }

  async makeGroupMessage (data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`
    }
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    if (config.toQQUin && Handler.has('ws.tool.findUserId')) {
      const user_id = await Handler.call('ws.tool.findUserId', { user_id: data.user_id })
      if (user_id?.custom) {
        userIdCache[user_id.custom] = data.user_id
        data.sender.user_id = user_id.custom
      }
    }

    // 自定义消息过滤前台日志防刷屏(自欺欺人大法)
    const filterLog = config.filterLog?.[data.self_id] || []
    let logStat = filterLog.includes(_.trim(data.raw_message)) ? 'debug' : 'info'
    Bot.makeLog(logStat, `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)

    data.reply = msg => this.sendGroupMsg({
      ...data, group_id: event.group_id
    }, msg, { id: data.message_id })
    // data.message.unshift({ type: "at", qq: data.self_id })
    await this.setGroupMap(data)
  }

  async makeDirectMessage (data, event) {
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
    await this.setFriendMap(data)
  }

  async makeGuildMessage (data, event) {
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
    if (config.toQQUin && Handler.has('ws.tool.findUserId')) {
      const user_id = await Handler.call('ws.tool.findUserId', { user_id: data.user_id })
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
    await this.setFriendMap(data)
    await this.setGroupMap(data)
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
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
      get user_id () { return this.sender.user_id },
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
        if (data.sub_type == 'friend') {
          await this.makeFriendMessage(data, event)
        } else {
          await this.makeDirectMessage(data, event)
        }
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
    Bot[data.self_id].dau.setDau('receive_msg', data)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeCallback (id, event) {
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
      get user_id () { return this.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: ''
    }

    const callback = data.bot.callback[event.data?.resolved?.button_id]
    if (callback) {
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
        await this.setFriendMap(data)
        break
      case 'group':
        data.group_id = `${id}${this.sep}${event.group_id}`
        Bot.makeLog('info', [`群按钮点击事件：[${data.group_id}, ${data.user_id}]`, data.raw_message], data.self_id)

        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
        await this.setGroupMap(data)
        break
      case 'guild':
        break
      default:
        Bot.makeLog('warn', ['未知按钮点击事件', event], data.self_id)
    }

    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  makeNotice (id, event) {
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
        return this.makeCallback(id, event)
      case 'increase':
        Bot[data.self_id].dau.setDau('group_increase', data)
        if (event.notice_type === 'group') {
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
                this.sendMsg(data, `groups/${event.group_id}`, msg => data.bot.sdk.sendGroupMessage(event.group_id, msg), msg)
              }
            })
          }
        }
        return
      case 'decrease':
        Bot[data.self_id].dau.setDau('group_decrease', data)
      case 'update':
      case 'member.increase':
      case 'member.decrease':
      case 'member.update':
        break
      default:
        Bot.makeLog('warn', ['未知通知', event], id)
    }

    // Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
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
      login () {
        return new Promise(resolve => {
          this.sdk.sessionManager.once('READY', resolve)
          this.sdk.start()
        })
      },
      logout () {
        return new Promise(resolve => {
          this.sdk.ws.once('close', resolve)
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
      fl: await this.getFriendMap(id),

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap () { return this.gl },
      gl: await this.getGroupMap(id),
      gml: await this.getMemberMap(id),

      dau: new Dau(id, this.sep),

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
    await Bot[id].dau.init()

    Bot[id].sdk.on('message', event => this.makeMessage(id, event))
    Bot[id].sdk.on('notice', event => this.makeNotice(id, event))

    Bot.makeLog('mark', `${this.name}(${this.id}) ${this.version} 已连接`, id)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async load () {
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
  二维码: 'toQRCode',
  按钮回调: 'toCallback',
  转换: 'toQQUin',
  转图片: 'toImg',
  调用统计: 'callStats',
  用户统计: 'userStats'
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
          reg: /^#q+bot用户统计$/i,
          fnc: 'userStat',
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
      ],
      [
        { text: `${config.userStats ? '关闭' : '开启'}用户统计`, callback: `#QQBot设置用户统计${config.userStats ? '关闭' : '开启'}` }
      ]
    )])
  }

  refConfig () {
    config = YAML.parse(fs.readFileSync('config/QQBot.yaml', 'utf-8'))
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

  async userStat () {
    if (!config.userStats) return false
    const dau = this.e.bot.dau
    if (!dau) return false
    const msg = dau.getUserStatsMsg(this.e)
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
    const msg = await importJS('Model/template/oneKeySendGroupMsg.js', 'default')
    if (msg === false) {
      this.reply('请先设置模版哦', true)
    } else {
      const groupList = this.e.bot.dau.getProp('all_group')
      const getMsg = typeof msg === 'function' ? msg : () => msg
      const errGroupList = []
      for (const key in groupList) {
        if (key === 'total') continue
        const sendMsg = await getMsg(`${this.e.self_id}${this.e.bot.adapter.sep}${key}`)
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
    }
  }
}

const endTime = new Date()
logger.info(logger.green(`- QQBot 适配器插件 加载完成! 耗时：${endTime - startTime}ms`))

logger.info(logger.yellow("- 正在加载 QQBot 适配器插件"))

import { config, configSave } from "./Model/config.js"
import fs from "node:fs"
import path from "node:path"
import QRCode from "qrcode"
import imageSize from "image-size"
import { randomUUID } from "node:crypto"
import { encode as encodeSilk } from "silk-wasm"
import { Bot as QQBot } from "qq-group-bot"
import Runtime from "../../lib/plugins/runtime.js"

const userIdCache = {}
const findUser_id = await (async () => {
  try {
    return (await import('../ws-plugin/model/db/index.js')).findUser_id
  } catch (error) {
    return false
  }
})()
const toImg = await (async () => {
  try {
    return (await import('../ws-plugin/model/index.js')).toImg
  } catch (error) {
    return false
  }
})()

const adapter = new class QQBotAdapter {
  constructor() {
    this.id = "QQBot"
    this.name = "QQBot"
    this.version = `qq-group-bot ${config.package.dependencies["qq-group-bot"].replace("^", "v")}`

    if (typeof config.toQRCode == "boolean")
      this.toQRCodeRegExp = config.toQRCode ? /https?:\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])?/g : false
    else
      this.toQRCodeRegExp = new RegExp(config.toQRCode, "g")
  }

  async makeSilk(file) {
    const inputFile = path.join("temp", randomUUID())
    const pcmFile = path.join("temp", randomUUID())

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
    return (await QRCode.toDataURL(data)).replace("data:image/png;base64,", "base64://")
  }

  async makeRawMarkdownText(data) {
    const match = data.match(this.toQRCodeRegExp)
    if (match) for (const url of match) {
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
        style: 1,
        ...button.QQBot?.render_data,
      }
    }

    if (button.input)
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.input,
        enter: button.send,
        ...button.QQBot?.action,
      }
    else if (button.callback)
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.callback,
        enter: true,
        ...button.QQBot?.action,
      }
    else if (button.link)
      msg.action = {
        type: 0,
        permission: { type: 2 },
        data: button.link,
        ...button.QQBot?.action,
      }
    else return false

    if (button.permission) {
      if (button.permission == "admin") {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission))
          button.permission = [button.permission]
        for (const id of button.permission)
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}:`, ""))
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
      msgs.push({ type: "button", buttons })
    }
    return msgs
  }


  async makeRawMarkdownMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let content = ""
    const button = []
    let reply

    for (let i of msg) {
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "video":
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          messages.push(i)
          break
        case "at":
          if (i.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.qq.replace(`${data.self_id}:`, "")}>`
          break
        case "text":
          content += await this.makeRawMarkdownText(i.text)
          break
        case "image": {
          const { dec, url } = await this.makeImage(i.file)
          content += `![${dec}](${url})`
          break
        } case "markdown":
          content += i.data
          break
        case "button":
          button.push(...this.makeButtons(data, i.data))
          break
        case "face":
          break
        case "reply":
          reply = i
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeRawMarkdownMsg(data, message)))
          continue
        case "raw":
          messages.push(i.data)
          break
        default:
          content += await this.makeRawMarkdownText(JSON.stringify(i))
      }
    }

    if (content)
      messages.unshift([{ type: "markdown", content }, ...button])
    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  makeMarkdownTemplate(data, template) {
    const params = []
    for (const i of ["text_start", "img_dec", "img_url", "text_end"])
      if (template[i]) params.push({ key: i, values: [template[i]] })
    return {
      type: "markdown",
      custom_template_id: config.markdown[data.self_id],
      params,
    }
  }

  async makeMarkdownMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let content = ""
    let button = []
    let template = {}
    let reply
    let raw = []

    for (let i of msg) {
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "video":
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          messages.push(i)
          break
        case "at":
          if (i.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.qq.replace(`${data.self_id}:`, "")}>`
          break
        case "text":
          content += i.text
          break
        case "image": {
          const { dec, url } = await this.makeImage(i.file)

          if (template.img_dec && template.img_url) {
            template.text_end = content
            messages.push([
              this.makeMarkdownTemplate(data, template),
              ...button,
            ])
            content = ""
            button = []
          }

          template = {
            text_start: content,
            img_dec: dec,
            img_url: url,
          }
          content = ""
          break
        } case "markdown":
          if (typeof i.data == "object")
            messages.push({ type: "markdown", ...i.data })
          else
            messages.push({ type: "markdown", content: i.data })
          break
        case "button":
          button.push(...this.makeButtons(data, i.data))
          break
        case "face":
          break
        case "reply":
          reply = i
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeMarkdownMsg(data, message)))
          continue
        case "raw":
          raw.push(i.data)
          // messages.push(i.data)
          break
        default:
          content += JSON.stringify(i)
      }

      if (content) {
        content = content.replace(/\n/g, "\r")
        const match = content.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          const msg = segment.image(await Bot.fileToUrl(await this.makeQRCode(url)))
          messages.push(msg)
          content = content.replace(url, "[链接(请扫码查看)]")
        }
      }
    }
    if (raw) {
      messages.push(raw)
    }
    if (template.img_dec && template.img_url) {
      template.text_end = content
    } else if (content) {
      template = { text_start: content, text_end: "" }
    }
    if (template.text_start || template.text_end || (template.img_dec && template.img_url))
      messages.push([
        this.makeMarkdownTemplate(data, template),
        ...button,
      ])
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
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "at":
          // i = { type: 'text', text: '\n' }
          continue
        case "text":
        case "face":
        case "ark":
        case "embed":
          break
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "image":
        case "video":
        case "file":
          if (i.file)
            i.file = await Bot.fileToUrl(i.file)
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
          }
          break
        case "reply":
          reply = i
          continue
        case "markdown":
          if (typeof i.data == "object")
            i = { type: "markdown", ...i.data }
          else
            i = { type: "markdown", content: i.data }
          break
        case "button":
          message.push(...this.makeButtons(data, i.data))
          continue
        case "node":
          if (toImg) {
            const e = {
              reply: (msg) => {
                i = msg
              },
              bot: {
                uin: this.uin,
                nickname: Bot[this.uin].sdk.nickname
              }
            }
            e.runtime = new Runtime(e)
            await toImg(i.data, e, true)
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
        case "raw":
          i = i.data
          break
        default:
          i = { type: "text", data: { text: JSON.stringify(i) } }
      }

      if (i.type == "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          const msg = segment.image(await Bot.fileToUrl(await this.makeQRCode(url)))
          if (message.some(s => sendType.includes(s.type))) {
            messages.push(message)
            message = []
          }
          message.push(msg)
          i.text = i.text.replace(url, "[链接(请扫码查看)]")
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
    if (config.markdown[data.self_id]) {
      if (config.markdown[data.self_id] == "raw") {
        msgs = await this.makeRawMarkdownMsg(data, msg)
      } else {
        /*let needMd = false
        if (Array.isArray(msg)) for (const i of msg)
          if (typeof i == "object" && i.type == "button") {
            needMd = true
            break
          }
        if (needMd)*/
        msgs = await this.makeMarkdownMsg(data, msg)
        /*else
          msgs = await this.makeMsg(data, msg)*/
      }
    } else if (config.toMd) {
      msgs = await this.toMd(data, msg)
    } else {
      msgs = await this.makeMsg(data, msg)
    }

    for (const i of msgs) try {
      const ret = await send(i)
      if (ret) {
        rets.data.push(ret)
        if (ret.msg_id || ret.sendResult?.msg_id)
          rets.message_id.push(ret.msg_id || ret.sendResult.msg_id)
      }
    } catch (err) {
      Bot.makeLog("error", `发送消息错误：${Bot.String(msg)}`)
      if (err.response?.data) {
        const error = { ...err.response.data }
        error.traceID = err.response.headers?.['x-tps-trace-id']
        logger.error(error)
      } else {
        logger.error(err)
      }
    }
    return rets
  }

  sendReplyMsg(data, msg, event) {
    Bot.makeLog("info", `发送回复消息：[${data.group_id ? `${data.group_id}, ` : ""}${data.user_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => event.reply(msg), msg)
  }

  sendFriendMsg(data, msg, event) {
    Bot.makeLog("info", `发送好友消息：[${data.user_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendPrivateMessage(data.user_id, msg, event), msg)
  }

  sendGroupMsg(data, msg, event) {
    Bot.makeLog("info", `发送群消息：[${data.group_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(data.group_id, msg, event), msg)
  }

  pickFriend(id, user_id) {
    if (config.toQQUin) {
      if (userIdCache[user_id]) {
        user_id = userIdCache[user_id]
      }
    }
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}:`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      sendFile: (file, name) => this.sendFriendMsg(i, segment.file(file, name)),
    }
  }

  pickMember(id, group_id, user_id) {
    if (config.toQQUin) {
      if (userIdCache[user_id]) {
        user_id = userIdCache[user_id]
      }
    }
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}:`, ""),
      group_id: group_id.replace(`${id}:`, ""),
    }
    return {
      ...this.pickFriend(id, user_id),
      ...i,
    }
  }

  pickGroup(id, group_id) {
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(`${id}:`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      sendFile: (file, name) => this.sendGroupMsg(i, segment.file(file, name)),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
    }
  }

  makeMessage(id, event) {
    const data = {
      event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_id: event.message_id,
      user_id: `${id}:${event.user_id}`,
      group_id: `${id}:${event.group_id}`,
      sender: {
        user_id: `${id}:${event.sender.user_id}`,
        user_openid: `${id}:${event.sender.user_openid}`
      },
      message: event.message,
      raw_message: event.raw_message,
    }
    data.bot.fl.set(data.user_id, data.sender)
    data.bot.stat.recv_msg_cnt++
    return data
  }

  makeFriendMessage(id, event) {
    const data = this.makeMessage(id, event)
    data.message_type = "private"
    delete data.group_id

    Bot.makeLog("info", `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
    Bot.em(`${data.post_type}.${data.message_type}`, data)
  }

  async makeGroupMessage(id, event) {
    const data = this.makeMessage(id, event)
    data.message_type = "group"
    data.bot.gl.set(data.group_id, {
      group_id: data.group_id,
      group_openid: data.event.group_openid,
    })
    data.reply = msg => this.sendReplyMsg(data, msg, event)
    if (config.toQQUin && findUser_id) {
      const user_id = await findUser_id({ user_id: data.user_id })
      if (user_id?.custom) {
        userIdCache[user_id.custom] = data.user_id
        data.user_id = user_id.custom
      }
      // const group_id = await findGroup_id({ group_id: data.group_id })
      // if (group_id?.custom) {
      //   data.group_id = group_id.custom
      // }
    }
    Bot.makeLog("info", `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
    Bot.em(`${data.post_type}.${data.message_type}`, data)
  }

  async toMd(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let message = []
    let content = ""
    let button = []
    let template = {}
    let reply

    for (let i of msg) {
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "video":
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          messages.push(i)
          break
        case "at":
          if (i.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.qq.replace(`${data.self_id}:`, "")}>`
          break
        case "text":
          content += i.text
          break
        case "image": {
          let { dec, url } = await this.makeImage(i.file)
          if (template.imagesize && template.im) {
            template.zuozhe = content
            messages.push([
              this.makeTemplate(data, template),
              ...button,
            ])
            content = ""
            button = []
          }

          template = {
            title: content,
            imagesize: dec,
            im: url,
          }
          content = ""
          break
        } case "markdown":
          if (typeof i.data == "object")
            messages.push({ type: "markdown", ...i.data })
          else
            messages.push({ type: "markdown", content: i.data })
          break
        case "button":
          button.push(...this.makeButtons(data, i.data))
          break
        case "face":
          break
        case "reply":
          reply = i
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.toMd(data, message)))
          continue
        case "raw":
          message.push(i.data)
          break
        default:
          content += JSON.stringify(i)
      }

      if (message.length) {
        messages.push(message)
      }

      if (content) {
        content = content.replace(/\n/g, "\r")
        const match = content.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          let { dec, url } = await this.makeImage(await this.makeQRCode(url))
          content = content.replace(url, "[链接(请扫码查看)]")
          if (template.img_dec && template.img_url) {
            template.zuozhe = content
            messages.push([
              this.makeTemplate(data, template),
              ...button,
            ])
            content = ""
            button = []
          }

          template = {
            title: content,
            imagesize: dec,
            im: url,
          }
          content = ""
        }
      }
    }
    if (template.imagesize && template.im) {
      template.zuozhe = content
    } else if (content) {
      template = { title: content, text_end: "" }
    }
    if (template.title || template.zuozhe || (template.imagesize && template.im))
      messages.push([
        this.makeTemplate(data, template),
        ...button,
      ])
    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  makeTemplate(data, template) {
    const params = []
    for (const i of ["title", "imagesize", "im", "zuozhe"])
      if (template[i]) params.push({ key: i, values: [template[i]] })
    return {
      type: "markdown",
      custom_template_id: '102053559_1702454556',
      params,
    }
  }

  async connect(token) {
    token = token.split(":")
    const id = token[0]
    const opts = {
      ...config.bot,
      appid: token[1],
      token: token[2],
      secret: token[3],
      intents: [
        "GUILDS",
        "GUILD_MEMBERS",
        "GUILD_MESSAGE_REACTIONS",
        "DIRECT_MESSAGE",
        "INTERACTION",
        "MESSAGE_AUDIT",
      ],
    }

    if (Number(token[4]))
      opts.intents.push("GROUP_AT_MESSAGE_CREATE", "C2C_MESSAGE_CREATE")

    if (Number(token[5]))
      opts.intents.push("GUILD_MESSAGES")
    else
      opts.intents.push("PUBLIC_GUILD_MESSAGES")

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
        version: this.version,
      },
      stat: {
        start_time: Date.now() / 1000,
        recv_msg_cnt: 0
      },

      pickFriend: user_id => this.pickFriend(id, user_id),
      get pickUser() { return this.pickFriend },
      getFriendMap() { return this.fl },
      fl: new Map,

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap() { return this.gl },
      gl: new Map,
      gml: new Map,
    }

    await Bot[id].login()

    Bot[id].sdk.logger = {}
    for (const i of ["trace", "debug", "info", "mark", "warn", "error", "fatal"])
      Bot[id].sdk.logger[i] = (...args) => Bot.makeLog(i, args, id)

    Bot[id].sdk.on("message.private", event => this.makeFriendMessage(id, event))
    Bot[id].sdk.on("message.group", event => this.makeGroupMessage(id, event))

    logger.mark(`${logger.blue(`[${id}]`)} ${this.name}(${this.id}) ${this.version} 已连接`)
    Bot.em(`connect.${id}`, { self_id: id })
    this.uin = id
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
      name: "QQBotAdapter",
      dsc: "QQBot 适配器设置",
      event: "message",
      rule: [
        {
          reg: "^#[Qq]+[Bb]ot账号$",
          fnc: "List",
          permission: config.permission,
        },
        {
          reg: "^#[Qq]+[Bb]ot设置[0-9]+:[0-9]+:.+:.+:[01]:[01]$",
          fnc: "Token",
          permission: config.permission,
        },
        {
          reg: "^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?[0-9]+:",
          fnc: "Markdown",
          permission: config.permission,
        },
        {
          reg: "^#[Qq]+[Bb]ot设置转换\\s*(开启|关闭)$",
          fnc: 'Setting',
          permission: config.permission,
        }
      ]
    })
  }

  List() {
    this.reply(`共${config.token.length}个账号：\n${config.token.join("\n")}`, true)
  }

  async Token() {
    const token = this.e.msg.replace(/^#[Qq]+[Bb]ot设置/, "").trim()
    if (config.token.includes(token)) {
      config.token = config.token.filter(item => item != token)
      this.reply(`账号已删除，重启后生效，共${config.token.length}个账号`, true)
    } else {
      if (await adapter.connect(token)) {
        config.token.push(token)
        this.reply(`账号已连接，共${config.token.length}个账号`, true)
      } else {
        this.reply(`账号连接失败`, true)
        return false
      }
    }
    configSave(config)
  }

  Markdown() {
    let token = this.e.msg.replace(/^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?/, "").trim().split(":")
    const bot_id = token.shift()
    token = token.join(":")
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    configSave(config)
  }

  async Setting() {
    const toQQUin = this.e.msg.includes('开启') ? true : false
    config.toQQUin = toQQUin
    this.reply('设置成功,已' + (toQQUin ? '开启' : '关闭'), true)
    configSave(config)
  }
}

logger.info(logger.green("- QQBot 适配器插件 加载完成"))
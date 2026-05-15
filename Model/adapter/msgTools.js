import _ from 'lodash'
import fs from 'node:fs'
import QRCode from 'qrcode'
import { join } from 'node:path'
import imageSize from 'image-size'
import { randomUUID } from 'node:crypto'
import { encode as encodeSilk } from 'silk-wasm'
import { Handler, splitMarkDownTemplate, getMustacheTemplating } from '../index.js'

export default {
  async qr (url) {
    const qrl = await QRCode.toDataURL(url)

    console.log('🚀 -------------🚀')
    console.log('🚀 ~ qrl:', qrl)
    console.log('🚀 -------------🚀')

    return qrl.replace('data:image/png;base64,', 'base64://')
  },
  async record (file, upload) {
    if (upload) {
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
  },
  async img (data, file, summary = '图片', config) {
    const buffer = await Bot.Buffer(file)
    let image = await uploadImg(buffer, config.toBotUpload) || { url: await Bot.fileToUrl(file) }

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

    if (Handler.has('QQBot.makeMarkdownImage')) {
      const res = await Handler.call(
        'QQBot.makeMarkdownImage',
        data,
        {
          image,
          buffer,
          file,
          summary,
          config
        }
      )
      if (res) typeof res === 'object' ? Object.assign(image, res) : image.url = res
    }

    return {
      des: `![${summary} #${image.width || 0}px #${image.height || 0}px]`,
      url: `(${image.url})`
    }

    async function uploadImg (file, upload) {
      if (upload) {
        for (const i of Bot.uin) {
          if (!Bot[i].uploadImage) continue
          if (Bot[i].adapter.name !== 'QQBot') continue
          try {
            const image = await Bot[i].uploadImage(file)
            if (image.url) return image
          } catch (err) {
            Bot.makeLog('error', ['Bot', i, '图片上传错误', file, err])
          }
        }
      }
    }
  },
  button (data, btnBlock) {
    const single = (data, btn) => {
      const msg = {
        id: randomUUID(),
        render_data: {
          label: btn.text,
          visited_label: btn.clicked_text,
          style: btn.style ?? 1,
          ...btn.QQBot?.render_data
        }
      }
      if (btn.input) msg.action = { type: 2, data: btn.input, enter: btn.send }
      else if (btn.callback) {
        if (this._exThis.cfg.toCallback) {
          msg.action = { type: 1 }
          if (!Array.isArray(data._ret_id)) data._ret_id = []

          data.bot.callback[msg.id] = {
            id: data.message_id,
            user_id: data.user_id,
            group_id: data.group_id,
            message: btn.callback,
            message_id: data._ret_id
          }
          setTimeout(() => delete data.bot.callback[msg.id], 300000)
        } else msg.action = { type: 2, data: btn.callback, enter: true }
      } else if (btn.link) msg.action = { type: 0, data: btn.link }
      else return false

      msg.action = { ...msg.action, permission: { type: 2 }, ...btn.QQBot?.action }
      if (btn.permission) {
        if (btn.permission === 'admin') msg.action.permission.type = 1
        else {
          msg.action.permission.type = 0
          msg.action.permission.specify_user_ids = []
          btn.permission = _.castArray(btn.permission)

          for (let id of btn.permission) {
            if (this._exThis.cfg.toQQUin && this._exThis.userCache[id]) id = this.userCache[id]
            msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this._exThis.sep}`, ''))
          }
        }
      }

      return msg
    }

    const msgs = []
    for (const row of btnBlock) {
      const buttons = []
      for (let btn of row) {
        btn = single(data, btn)
        if (btn) buttons.push(btn)
      }
      if (buttons.length) msgs.push({ type: 'button', data: { buttons } })
    }
    return msgs
  },
  async text (data, text, button, raw) {
    let qrReg = this._exThis.cfg.toQRCode
    if (typeof qrReg !== 'boolean') qrReg = new RegExp(this._exThis.cfg.toQRCode, 'g')
    else if (qrReg) qrReg = /(?<!\[(.*?)\]\()https?:\/\/[-\w_]+(\.[-\w_]+)+([-\w.,@?^=%&:/~+#]*[-\w@?^=%&/~+#])?/g

    const match = text.match(qrReg)
    if (match) {
      for (const url of match) {
        button.push(...this._callInternal('button', data, [[{ text: url, link: url }]]))
        if (raw) {
          const qrl = await this._callInternal('qr', url)
          const img = await this._callInternal('img', data, qrl, '二维码', this._exThis.cfg)
          text = text.replace(url, `${img.des}${img.url}`)
        } else text = text.replace(url, '[链接(请点击按钮查看)]')
      }
    }

    if (!raw) text = text.replace(/\n/g, '\r')
    return text.replace(/@/g, '@​')
  },
  template (data, template, mdTemplate, config) {
    let keys, custom_template_id
    let params = []
    let index = 0
    let type = 0
    const result = []

    if (mdTemplate) {
      custom_template_id = mdTemplate.custom_template_id
      params = _.cloneDeep(mdTemplate.params)
      type = 1
    } else {
      const custom = config.customMD?.[data.self_id]
      custom_template_id = custom?.custom_template_id || config.markdown[data.self_id]
      keys = _.cloneDeep(custom?.keys) || config.markdown.template.split('')
    }

    for (const temp of template) {
      if (!temp.length) continue

      for (const i of splitMarkDownTemplate(temp)) {
        if (index == (type == 1 ? mdTemplate.params.length : keys.length)) {
          result.push({ type: 'markdown', custom_template_id, params: _.cloneDeep(params) })
          params = type == 1 ? _.cloneDeep(mdTemplate.params) : []
          index = 0
        }

        if (type == 1) params[index].values = [i]
        else params.push({ key: keys[index], values: [i] })
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

    if (params.length) result.push({ type: 'markdown', custom_template_id, params })
    return result
  },
  call (fn, thisArg, ...args) {
    fn = this[fn]
    // 保存外部 this
    this._exThis = thisArg
    return Reflect.apply(fn, this, args)
  },
  // 内部调用入口（必须用这个）
  _callInternal (fnName, ...args) {
    const fn = this[fnName]
    return Reflect.apply(fn, this, args)
  }
}

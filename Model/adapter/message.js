import base from './base.js'
import { Handler, importJS, Runtime } from '../index.js'
import _ from 'lodash'
import Tools from './msgTools.js'

const markdown_template = await importJS('Model/template/markdownTemplate.js', 'default')
const TmplPkg = await importJS('templates/index.js')

export default class Message extends base {
  /**
   * 制作发送消息
   * @param {object} data e
   * @param {object|array} msg 消息
   * @param {0|1|2} md 0:普通, 1:模板 2:原生
   * @returns
   */
  async makeMsg (data, msg, md = 0) {
    const sendType = ['audio', 'image', 'video', 'file']
    let tempMsg = []
    const checkST = () => {
      if (tempMsg.some(s => sendType.includes(s.type))) {
        messages.push(tempMsg)
        tempMsg = []
      }
    }

    const messages = []
    const button = []
    let reply

    // 模板参数
    let template = []
    let content = ''
    const length = markdown_template?.params?.length || this.cfg.customMD?.[data.self_id]?.keys?.length || this.cfg.markdown.template.length

    for (let i of _.castArray(msg)) {
      if (typeof i == 'object') i = { type: i.type, data: { ...i } }
      else i = { type: 'text', data: { text: i } }

      switch (i.type) {
        case 'record':
          i.type = 'audio'
          i.data.file = await Tools.call('record', '', i.file, this.cfg)
        case 'video':
          if (!md) {
            checkST()
            break
          }
        case 'face':
        case 'ark':
        case 'embed':
          if (md) messages.push([i])
          break
        case 'file':
          return []
        case 'at':
          if (md) {
            if (i.data.qq === 'all') content += '@everyone'
            else {
              if (this.cfg.toQQUin && this.userCache[i.data.qq]) i.qq = this.userCache[i.data.qq]
              content += `<@${i.data.qq?.replace?.(`${data.self_id}${this.sep}`, '')}>`
            }
            break
          } else continue
        case 'text':
          if (md) content += await Tools.call('text', this, data, i.data.text, button, md === 2)
          break
        case 'node':
          if (Handler.has('ws.tool.toImg') && this.cfg.toImg) {
            await this.#ws2Img(i, data, md, button, checkST)
          } else if (TmplPkg?.nodeMsg && md) {
            messages.push(...await this.makeMsg(data, TmplPkg.nodeMsg(i.data.data), md))
            continue
          } else {
            for (const { message } of i.data.data) {
              messages.push(...await this.makeMsg(data, message, md))
            }
            if (md) continue
          }
          if (!md) break
        case 'image':
          if (md) {
            const { des, url } = await Tools.call('img', '', data, i.data.file, i.data.summary, this.cfg)
            if (md === 1) {
              const limit = template.length % (length - 1)

              // 图片数量超过模板长度时
              if (template.length && !limit) {
                if (content) template.push(content)
                template.push(des)
              } else template.push(content + des)

              content = url
            } else content += `${des}${url}`
          } else checkST()
          break
        case 'markdown':
          if (typeof i.data === 'object') {
            i = { type: 'markdown', data: i.data }
            if (md === 2) messages.push([i])
          } else {
            if (md) content += i.data.data
            else i = { type: 'markdown', content: i.data.data }
          }
          break
        case 'button':
          (this.cfg.sendButton || md) && button.push(...Tools.call('button', this, data, i.data.data))
          if (md) break
          else continue
        case 'reply':
          if (i.data.id.startsWith('event_')) reply = { type: 'reply', event_id: i.data.id.replace(/^event_/, '') }
          else reply = i
          continue
        case 'raw':
          if (md) messages.push(_.castArray(i.data.data))
          else {
            if (Array.isArray(i.data.data)) {
              messages.push(i.data.data)
              continue
            }
            i = i.data
          }
          break
        case 'custom':
          if (md === 1) {
            template.push(...i.data.data)
            break
          }
        default:
          if (md) content += Tools.call('text', this, data, JSON.stringify(i), button, md === 2)
          else i = { type: 'text', text: JSON.stringify(i) }
      }

      if (!md) {
        if (i.type === 'text' && i.text) {
          const match = i.text.match(this.toQRCodeRegExp)
          if (match) {
            for (const url of match) {
              const msg = segment.image(await Bot.fileToUrl(await Tools.call('qr', '', url, data)))
              checkST()
              tempMsg.push(msg)
              i.text = i.text.replace(url, '[链接(请扫码查看)]')
            }
          }
        }

        if (i.type !== 'node') tempMsg.push(i)
      }
    }

    if (tempMsg.length) messages.push(tempMsg)
    else if (content) {
      // 正文
      if (md === 1) {
        template.push(content)

        if (template.length > length) {
          const templates = _(template).chunk(length).map(v => Tools.call('template', '', data, v, markdown_template, this.cfg)).value()
          messages.push(...templates)
        } else {
          const tmp = Tools.call('template', '', data, template, markdown_template, this.cfg)
          if (tmp.length > 1) messages.push(...tmp.map(i => ([i])))
          else messages.push(tmp)
        }
      } else {
        if (this.cfg.mdSuffix?.[data.self_id]) {
          for (const suf of this.cfg.mdSuffix[data.self_id]) {
            content += suf.values[0]
          }
        }
        if (content) messages.unshift([{ type: 'markdown', data: { content } }])
      }

      // 按钮
      if (button.length < 5 && this.cfg.btnSuffix[data.self_id]) {
        let { position, values } = this.cfg.btnSuffix[data.self_id]
        position = +position - 1

        if (position > button.length) position = button.length

        const btn = values.filter(i => {
          if (i.show) {
            if (i.show.type === 'random' && i.show.data <= _.random(1, 100)) return false
          }
          return true
        })
        button.splice(position, 0, ...Tools.call('button', this, data, [btn]))
      }

      for (const i of messages) {
        if (!button.length) break
        if (i[0].type == 'markdown') i.push(...button.splice(0, 5))
      }
    }

    while (button.length) {
      let btnMsg
      if (!md) btnMsg = [{ type: 'keyboard', data: { content: { rows: button.splice(0, 5) } } }]
      else if (md === 1) btnMsg = [...Tools.call('template', '', data, [' '], markdown_template, this.cfg), ...button.splice(0, 5)]
      else btnMsg = [{ type: 'markdown', data: { content: ' ' } }, ...button.splice(0, 5)]
      messages.push(btnMsg)
    }

    if (reply) {
      for (const i of messages) {
        if (md === 2) {
          if (Array.isArray(messages[i])) messages[i].unshift(reply)
          else messages[i] = [reply, messages[i]]
        } else i.unshift(reply)
      }
    }

    return messages
  }

  async sendMsg (type, data, msg, event) {
    const selfId = data.self_id

    if (type === 'direct') {
      if (!data.guild_id) {
        if (!data.src_guild_id) {
          Bot.makeLog('error', [`发送频道私聊消息失败：[${data.user_id}] 不存在来源频道信息`, msg], data.self_id)
          return false
        }
        const dms = this.sdkCaller(type, 'create', data.user_id)
        data.guild_id = dms.guild_id
        data.channel_id = dms.channel_id
        data.bot.fl.set(`qg_${data.user_id}`, {
          ...data.bot.fl.get(`qg_${data.user_id}`),
          ...dms
        })
      }
    } else if (type === 'group') {
      if (Handler.has('QQBot.group.sendMsg')) {
        const res = await Handler.call(
          'QQBot.group.sendMsg',
          data,
          {
            self_id: selfId,
            group_id: `${selfId}${this.sep}${data.group_id}`,
            raw_group_id: data.group_id,
            user_id: data.user_id,
            msg,
            event
          }
        )
        if (res !== false) return res
      }
    }

    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const doSend = async () => {
      for (const i of msgs) {
        try {
          Bot.makeLog('debug', ['发送消息', i], selfId)
          const ret = await this.sdkCaller(type, 'send', data, i)
          Bot.makeLog('debug', ['发送消息返回', ret], selfId)

          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
          Bot[selfId].dau.setDau('send_msg', data)
        } catch (err) {
          // Bot.makeLog('error', ['发送消息错误', i, err], selfId)
          logger.error(selfId, '发送消息错误', i, err)
          rets.error.push(err)
          return false
        }
      }
    }

    if (TmplPkg?.Button && !data.toQQBotMD) this.#TmplRemake(data, msg)

    if ((this.cfg.markdown[selfId] || this.cfg.customMD[selfId]) && data.toQQBotMD !== false) {
      if (this.cfg.markdown[selfId] === 'raw') msgs = await this.makeMsg(data, msg, 2)
      else msgs = await this.makeMsg(data, msg, 1)

      const [mds, btns] = _.partition(msgs[0], v => v.type === 'markdown')
      if (mds.length > 1) {
        for (const idx in mds) {
          msgs = mds[idx]
          if (idx === mds.length - 1) msgs.push(...btns)
          await doSend()
        }
        return rets
      }
    } else msgs = await this.makeMsg(data, msg)

    if (await doSend() === false) {
      msgs = await this.makeMsg(data, msg)
      await doSend()
    }
    // from sendGMsg
    // msgs = await this.makeGuildMsg(data, msg)
    // if (await sendMsg() === false) {
    //   msgs = await this.makeGuildMsg(data, msg)
    //   await sendMsg()
    // }

    if (Array.isArray(data._ret_id)) data._ret_id.push(...rets.message_id)
    return rets
  }

  /**
   * 撤回消息
   * @param {object} data e
   * @param {string|number} message_id 消息id
   * @param {'private'|'group'|'direct'|'guild'} type 消息类型
   * @param {boolean} hide 是否隐藏撤回消息（仅频道消息）
   */
  async recallMsg (type, data, message_id, hide = this.cfg.hideGuildRecall) {
    if (['private', 'group'].includes(type)) hide = false

    hide = hide ? '并隐藏' : ''
    const btype = this.BaseType[type]

    if (!Array.isArray(message_id)) message_id = [message_id]

    const msgs = []
    for (const i of message_id) {
      try {
        Bot.makeLog('info', `撤回${hide}${btype.name}消息：[${data[btype.id]}] ${message_id}`, data.self_id)
        msgs.push(await this.sdkCaller(type, 'recall', data, i))
      } catch (err) {
        Bot.makeLog('debug', ['撤回消息错误', i, err], data.self_id)
        msgs.push(false)
      }
    }
    return msgs
  }

  #TmplRemake (data, msg) {
    let fncName = /\[.*?\((\S+)\)\]/.exec(data.logFnc)
    console.log(fncName)
    const Btn = TmplPkg.Button[fncName]

    if (msg.type === 'node') data.wsids = { toImg: this.cfg.toImg }

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

      const _btn = msg.findIndex(b => b.type === 'button')
      if (_btn === -1) msg.push(res)
      else msg[_btn] = res
    }
  }

  async #ws2Img (i, data, md, button, checkST) {
    let result
    if (md === 1) {
      const getButton = b => {
        return b.flatMap(item => {
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
      result = btn.reduce((acc, cur) => {
        const duplicate = acc.find(obj => _.isMatch(obj, cur))
        if (!duplicate) return acc.concat([cur])
        else return acc
      }, [])
    }

    const e = {
      reply: (msg) => {
        i = msg
      },
      user_id: data.bot.uin,
      nickname: data.bot.nickname
    }
    e.runtime = new Runtime(e)

    if (md === 1) i.data.cfg = { retType: 'msgId', returnID: true }
    let { wsids } = await Handler.call('ws.tool.toImg', e, i.data)

    if (result) {
      if (!result.length && data.wsids?.fnc) {
        wsids = wsids.map((id, k) => ({ text: `${data.wsids.text}${k}`, callback: `#ws查看${id}` }))
        result = _.chunk(_.tail(wsids), data.wsids.col)
      }

      for (const b of result) {
        button.push(...Tools.call('button', this, data, b.data ? b.data : [b]))
      }
    }

    if (!md) checkST()
  }
}

import _ from 'lodash'
import { importJS, config, configSave, refConfig } from './Model/index.js'
import QQBotAdapter from './Model/adapter/index.js'

const startTime = new Date()
logger.info(logger.yellow('- 正在加载 QQBot 适配器插件'))

const adapter = new QQBotAdapter()
Bot.adapter.push(adapter)

const setMap = {
  二维码: 'toQRCode',
  按钮回调: 'toCallback',
  转换: 'toQQUin',
  转图片: 'toImg',
  调用统计: 'callStats',
  用户统计: 'userStats',
  官Bot过滤: 'filterBot'
}

let ruleMap = {
  help: '(帮助|help)',
  List: '账号',
  Token: '设置[0-9]+:[0-9]+:.+:.+:[01]:[01]',
  Markdown: 'm(ark)?d(own)?[0-9]+:',
  Setting: `设置(${Object.keys(setMap).join('|')})\\s*(开启|关闭)`,
  DAUStat: 'dau',
  callStat: '调用统计',
  userStat: '用户统计',
  refConfig: '刷新co?n?fi?g',
  filterLog: '(添加|删除)过滤日志',
  oneKeySendGroupMsg: '一键群发'
}

ruleMap = _.reduce(ruleMap, (acc, v, k) => {
  acc.push({
    reg: new RegExp(`^#q+bot${v}$`, 'i'),
    fnc: k,
    permission: config.permission
  })
  return acc
}, [])

export class QQBotConfig extends plugin {
  constructor () {
    super({
      name: 'QQBotAdapter',
      dsc: 'QQBot 适配器设置',
      event: 'message',
      rule: ruleMap
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
    refConfig()
  }

  List () {
    this.reply(`共${config.token.length}个账号：\n${config.token.join('\n')}`, true)
  }

  async Token () {
    const token = this.e.msg.replace(/^#q+bot设置/i, '').trim()
    if (config.token.includes(token)) {
      _.pull(config.token, token)
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
    const state = regRet[2] === '开启'
    config[setMap[regRet[1]]] = state
    this.reply('设置成功,已' + regRet[2], true)
    await configSave()
  }

  async DAUStat () {
    const pro = this.e.msg.includes('pro')
    const uin = this.e.msg.replace(/^#q+botdau(pro)?/i, '') || this.e.self_id
    const dau = Bot[uin]?.dau
    if (!dau || !dau.dauDB) return false
    const msg = await dau.getDauStatsMsg(this.e, pro)
    if (msg.length) this.reply(msg, true)
  }

  async callStat () {
    if (!config.callStats) return false
    const dau = this.e.bot.dau
    if (!dau || !dau.dauDB) return false
    const msg = dau.getCallStatsMsg(this.e)
    if (msg.length) this.reply(msg, true)
  }

  async userStat () {
    if (!config.userStats) return false
    const dau = this.e.bot.dau
    if (!dau || !dau.dauDB) return false
    if (dau.dauDB === 'redis') return this.reply('用户统计只适配了level,,,', true)
    const msg = await dau.getUserStatsMsg(this.e)
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
      const groupList = this.e.bot.dau.dauDB === 'level' ? Object.keys(this.e.bot.dau.all_group) : [...this.e.bot.gl.keys()]
      const getMsg = typeof msg === 'function' ? msg : () => msg
      const errGroupList = []
      for (const key of groupList) {
        if (key === 'total') continue
        const id = this.e.bot.dau.dauDB === 'level' ? `${this.e.self_id}${this.e.bot.adapter.sep}${key}` : key
        const sendMsg = await getMsg(id)
        if (!sendMsg?.length) continue
        const sendRet = await this.e.bot.pickGroup(id).sendMsg(sendMsg)
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
      logger.info(logger.green(`QQBot ${this.e.self_id} 群消息一键发送完成，共${groupList.length - 1}个群，失败${errGroupList.length}个`))
    }
  }
}

const endTime = new Date()
logger.info(logger.green(`- QQBot 适配器插件 加载完成! 耗时：${endTime - startTime}ms`))

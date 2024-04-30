import _ from 'lodash'
import fs from 'node:fs'
import moment from 'moment'
import Level from './level.js'
import { join } from 'node:path'
import schedule from 'node-schedule'
import { getTime } from './common.js'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'

//! 需顺序
const dauAttr = {
  receive_msg_count: '上行消息量',
  send_msg_count: '下行消息量',
  user_count: '上行消息人数',
  group_count: '上行消息群数',
  group_increase_count: '新增群数',
  group_decrease_count: '减少群数'
}

// 兼容一下旧数据
const oldAttr = {
  receive_msg_count: 'msg_count',
  send_msg_count: 'send_count'
}

const numToChinese = {
  /* eslint-disable object-property-newline */
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五',
  6: '六', 7: '七', 8: '八', 9: '九', 10: '十',
  11: '十一', 12: '十二', 13: '十三', 14: '十四', 15: '十五',
  16: '十六', 17: '十七', 18: '十八', 19: '十九', 20: '二十',
  21: '二十一', 22: '二十二', 23: '二十三', 24: '二十四', 25: '二十五',
  26: '二十六', 27: '二十七', 28: '二十八', 29: '二十九', 30: '三十'
}

const _path = process.cwd()

export default class Dau {
  constructor (self_id, sep) {
    this.self_id = String(self_id)
    this.sep = sep
  }

  #stats
  #message_id_cache = {}
  #call_stats
  /**
   * 今日新增群
   * @type {{[key:string]:number}}
   */
  #group_increase
  /**
   * 今日减少群
   * @type {{[key:string]:number}}
   */
  #group_decrease
  /**
   * 今日新增用户
   * @type {Array<string>}
   */
  #user_increase
  /**
   * 定时任务
   */
  #job
  /**
   * 今天的日期
   * @type {string}
   */
  #today
  /**
   * 昨天的日期
   * @type {string}
   */
  #yesterday
  #today_user_data
  #yestoday_user_data
  /**
   * 所有用户
   * @type {{total: number, [key:string] : {receive_msg_count: number, send_msg_count: number, call_stats: {total: number,[key:string]: number}}}
   */
  #all_user
  /**
   * 所有群聊
   * @type {{total: number, [key:string] : {receive_msg_count: number, send_msg_count: number, call_stats: {total: number,[key:string]: number}}}}
   */
  #all_group
  /**
   * 所有群员
   * @type {{[key:string] : {total: number, [key:string] : {receive_msg_count: number, send_msg_count: number, call_stats: {total: number,[key:string]: number}}}}}
   */
  #all_group_member

  /**
   * 动态读取参数
   * @param {'stats'|'message_id_cache'|'call_stats'|'group_increase'|'group_decrease'|'today'|'yesterday'|'job'|'today_user_data'|'yestoday_user_data'|'#user_increase'|'all_user'|'all_group'|'all_group_member'} key
   */
  #getProp (key) {
    switch (key) {
      case 'stats':
        return this.#stats
      case 'message_id_cache':
        return this.#message_id_cache
      case 'call_stats':
        return this.#call_stats
      case 'group_increase':
        return this.#group_increase
      case 'group_decrease':
        return this.#group_decrease
      case 'user_increase':
        return this.#user_increase
      case 'today':
        return this.#today
      case 'yesterday':
        return this.#yesterday
      case 'today_user_data':
        return this.#today_user_data
      case 'yestoday_user_data':
        return this.#yestoday_user_data
      case 'job':
        return this.#job
      case 'all_user':
        return this.#all_user
      case 'all_group':
        return this.#all_group
      case 'all_group_member':
        return this.#all_group_member
      default:
        return {}
    }
  }

  /**
   * 对数据初始化
   */
  async init () {
    // 先初始化level
    const path = join(process.cwd(), 'plugins', 'QQBot-Plugin', 'db', this.self_id)
    this.db = new Level(path)
    await this.db.open()

    await this.#initData()

    // 定时任务
    this.#job = this.#setScheduleJob()
  }

  /**
   * dau统计
   * @param {*} pro
   * @returns
   */
  async getDauStatsMsg (e, pro) {
    let msg = [this.#today, ...this.#toDauMsg(this.#stats, 6), '']

    const path = join(_path, 'data', 'QQBotDAU', this.self_id)
    const yearMonth = moment(this.#today).format('YYYY-MM')
    // 昨日DAU
    try {
      const day = this.#today.slice(-2)
      const yestodayMonth = day == '01' ? moment(this.#today).subtract(1, 'days').format('YYYY-MM') : yearMonth
      let yesterdayDau = JSON.parse(fs.readFileSync(join(path, `${yestodayMonth}.json`), 'utf8'))
      yesterdayDau = _.find(yesterdayDau, v => moment(v.time).isSame(moment(this.#today).subtract(1, 'd')))
      msg.push(...[yesterdayDau.time, ...this.#toDauMsg(yesterdayDau, 6), ''])
    } catch (error) { }

    // 最近30天平均
    let totalDAU = _.reduce(_.keys(dauAttr), (acc, key) => {
      acc[key] = 0
      return acc
    }, {})
    let days = 0
    try {
      let days30 = [yearMonth, moment(yearMonth).subtract(1, 'm').format('YYYY-MM')]
      days30 = _(days30).map(v => {
        let file = join(path, `${v}.json`)
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).reverse().map(v => this.#mergeOldDau(v)) : []
      }).flatten().take(30).value()
      days = days30.length
      totalDAU = _.mapValues(totalDAU, (v, k) => _.floor(_.meanBy(days30, k)))
    } catch (error) { }

    days = numToChinese[days] || days
    msg.push(...[`最近${days}天平均`, ...this.#toDauMsg(totalDAU, 4)])
    msg = msg.join('\n')

    if (pro) {
      if (!fs.existsSync(path)) return false
      let daus = fs.readdirSync(path)// .reverse().slice(0, 2)
      if (_.isEmpty(daus)) return false
      let data = _.fromPairs(daus.map(v => [v.replace('.json', ''), JSON.parse(fs.readFileSync(`${path}/${v}`))]))
      data = this.#monthlyDau(data)

      totalDAU.days = days
      let renderdata = {
        daus: JSON.stringify(data),
        // call_stats: JSON.stringify(this.#call_stats),
        totalDAU,
        todayDAU: this.#stats,
        monthly: _.keys(data).reverse(),
        nickname: Bot[this.self_id].nickname,
        avatar: Bot[this.self_id].avatar,
        tplFile: `${_path}/plugins/QQBot-Plugin/resources/html/DAU/DAU.html`,
        pluResPath: `${_path}/plugins/QQBot-Plugin/resources/`,
        _res_Path: `${_path}/plugins/genshin/resources/`
      }

      let img = await puppeteer.screenshot('DAU', renderdata)
      if (!img) return false
      msg = img
    }

    return [msg, this.#getButton(e.user_id)]
  }

  getCallStatsMsg (e) {
    const arr = _.entries(this.#call_stats).sort((a, b) => b[1] - a[1])
    const msg = [this.#today, '数据可能不准确,请自行识别']
    for (let i = 0; i < 10; i++) {
      if (!arr[i]) break
      const s = arr[i]
      msg.push(`${i + 1}: ${s[0]}\t\t${s[1]}次`)
    }
    return [msg.join('\n').replace(/\[(.*?)\]\[(.*?)\]/g, '【$1】【$2】'), this.#getButton(e.user_id)]
  }

  getUserStatsMsg (e) {
    const user_same_count = _.intersection(_.keys(this.#today_user_data.user), _.keys(this.#yestoday_user_data.user)).length
    const yesterday_user_count = _.size(this.#yestoday_user_data.user)
    const msg = [
      '总计数据:',
      '总用户量: ' + this.#all_user.total,
      '总群聊量: ' + this.#all_group.total,
      '',
      '新增数据:',
      `新增用户: ${this.#user_increase.length}`,
      `新增群数: ${_.size(this.#group_increase)}`,
      `减少群数: ${_.size(this.#group_decrease)}`,
      '',
      '相较昨日:',
      `相同用户: ${user_same_count}`,
      `减少用户: ${yesterday_user_count - user_same_count}`
    ]
    return [msg.join('\r'), this.#getButton(e.user_id)]
  }

  #getButton (user_id) {
    return segment.button([
      { text: 'dau', callback: '#QQBotdau', permission: user_id },
      { text: 'daupro', callback: '#QQBotdaupro', permission: user_id }
    ], [
      { text: '调用统计', callback: '#QQBot调用统计', permission: user_id },
      { text: '用户统计', callback: '#QQBot用户统计', permission: user_id }
    ])
  }

  #setScheduleJob () {
    return schedule.scheduleJob('0 0 0 * * ?', async () => {
      const yesMonth = moment().subtract(1, 'd').format('YYYY-MM')
      this.#today = getTime()
      this.#yesterday = getTime(-1)
      const path = join(process.cwd(), 'data', 'QQBotDAU')
      if (!fs.existsSync(path)) fs.mkdirSync(path)
      try {
        const data = this.#stats
        data.time = this.#yesterday

        await this.#initData()

        if (!fs.existsSync(join(path, this.self_id))) fs.mkdirSync(join(path, this.self_id))
        const filePath = join(path, this.self_id, `${yesMonth}.json`)
        const file = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : []
        file.push(data)
        fs.writeFile(filePath, JSON.stringify(file, '', '\t'), 'utf-8', () => { })
      } catch (error) {
        logger.error('清除DAU数据出错,self_id: ' + this.self_id, error)
      }
    })
  }

  /**
   * 兼容旧数据 三十天后删除 2024年4月11日
   * @param {*} data
   */
  #mergeOldDau (data) {
    for (const k in oldAttr) {
      !data[k] && (data[k] = data[oldAttr[k]])
    }
    return data
  }

  /**
   * 月度统计
   * @param {object} dat
   * @returns
   */
  #monthlyDau (data) {
    const convertChart = (type, day, prefix = '') => {
      day = this.#mergeOldDau(day)
      let chartData = { time: day.time }
      chartData[`${prefix}name`] = dauAttr[`${type}_count`]
      chartData[`${prefix}count`] = day[`${type}_count`]
      return chartData
    }

    data = _.mapValues(data, v => {
      let coldata = []
      let linedata = []
      _.each(v, day => {
        coldata.push(convertChart('user', day), convertChart('group', day))
        linedata.push(convertChart('receive_msg', day, 'line'), convertChart('send_msg', day, 'line'))
      })
      return [linedata, coldata]
    })

    return data
  }

  async #initData () {
    // 时间
    this.#today = getTime()
    this.#yesterday = getTime(-1)

    // 用户和群统计
    this.#today_user_data = await this.#getDB('user_group_stats') || { user: {}, group: {} }
    this.#yestoday_user_data = await this.#getDB('user_group_stats', this.#yesterday) || { user: {}, group: {} }

    // DAU统计
    this.#stats = await this.#getDB('dau_stats') || _.reduce(_.keys(dauAttr), (acc, key) => {
      acc[key] = 0
      return acc
    }, {})

    // 调用统计
    this.#call_stats = await this.#getDB('call_stats') || {}

    // 新增群, 减少群, 新增用户 列表
    this.#group_increase = await this.#getDB('group_increase') || {}
    this.#group_decrease = await this.#getDB('group_decrease') || {}
    this.#user_increase = await this.#getDB('user_increase') || []

    // 所有用户, 群聊, 群员统计
    this.#all_user = await this.#getDB('all_user', null) || { total: 0 }
    this.#all_group = await this.#getDB('all_group', null) || { total: 0 }
    this.#all_group_member = await this.#getDB('all_group_member', null) || {}
  }

  #toDauMsg (data, num = 0) {
    const msg = []
    _.each(dauAttr, (v, k) => {
      if (data[k] !== undefined) {
        msg.push(`${v}：${data[k]}`)
      } else {
        msg.push(`${v}：${data[oldAttr[k]]}`)
      }
    })
    return num ? _.take(msg, num) : msg
  }

  /**
   * @param {'send_msg'|'receive_msg'|'group_increase'|'group_decrease'} type
   */
  async setDau (type, data) {
    const user_id = data.user_id?.replace?.(this.self_id + this.sep, '')
    const group_id = data.group_id?.replace?.(this.self_id + this.sep, '')
    const key = `${type}_count`
    switch (type) {
      case 'send_msg':
        this.#stats[key]++
        await this.#setLogFnc(user_id, group_id, data.logFnc, data.message_id)
        break
      case 'receive_msg':
        this.#stats[key]++
        await this.#setUserOrGroupStats(user_id, group_id)
        break
      case 'group_decrease':
        delete this.#all_group[group_id]
        this.#all_group.total--
        delete this.#all_group_member[group_id]
        await this.#setDB('all_group', this.#all_group, 0)
        await this.#setDB('all_group_member', this.#all_group_member, 0)
      case 'group_increase':
        if (!this.#getProp(type)[group_id]) {
          this.#stats[key]++
          this.#getProp(type)[group_id] = 0
        }
        this.#getProp(type)[group_id]++
        this.#setDB(type, this.#getProp(type), 2)
        break
    }
    await this.#setDB('dau_stats', this.#stats)
  }

  async #setLogFnc (user_id, group_id, logFnc, message_id) {
    if (!logFnc) return
    // 每个消息只记录一次
    if (this.#message_id_cache[message_id]) return
    if (!this.#call_stats[logFnc]) this.#call_stats[logFnc] = 0
    this.#call_stats[logFnc]++
    await this.#setDB('call_stats', this.#call_stats, 2)
    this.#message_id_cache[message_id] = setTimeout(() => {
      delete this.#message_id_cache[message_id]
    }, 60 * 5 * 1000)

    if (group_id) {
      if (!this.#all_group[group_id]) {
        this.#all_group.total++
        this.#all_group[group_id] = {
          receive_msg_count: 0,
          send_msg_count: 0,
          call_stats: {
            total: 0
          }
        }
      }
      if (!this.#all_group[group_id].call_stats[logFnc]) {
        this.#all_group[group_id].call_stats.total++
        this.#all_group[group_id].call_stats[logFnc] = 0
      }
      this.#all_group[group_id].send_msg_count++
      this.#all_group[group_id].call_stats[logFnc]++
      await this.#setDB('all_group', this.#all_group, 0)
    }

    if (user_id) {
      if (!this.#all_user[user_id]) {
        this.#all_user.total++
        this.#all_user[user_id] = {
          receive_msg_count: 0,
          send_msg_count: 0,
          call_stats: {
            total: 0
          }
        }
      }
      if (!this.#all_user[user_id].call_stats[logFnc]) {
        this.#all_user[user_id].call_stats.total++
        this.#all_user[user_id].call_stats[logFnc] = 0
      }
      this.#all_user[user_id].send_msg_count++
      this.#all_user[user_id].call_stats[logFnc]++
      await this.#setDB('all_user', this.#all_user, 0)
    }

    if (group_id && user_id) {
      if (!this.#all_group_member[group_id]) {
        this.#all_group_member[group_id] = {
          total: 0
        }
      }
      if (!this.#all_group_member[group_id][user_id]) {
        this.#all_group_member[group_id].total++
        this.#all_group_member[group_id][user_id] = {
          receive_msg_count: 0,
          send_msg_count: 0,
          call_stats: {
            total: 0
          }
        }
      }
      if (!this.#all_group_member[group_id][user_id].call_stats[logFnc]) {
        this.#all_group_member[group_id][user_id].call_stats.total++
        this.#all_group_member[group_id][user_id].call_stats[logFnc] = 0
      }
      this.#all_group_member[group_id][user_id].send_msg_count++
      this.#all_group_member[group_id][user_id].call_stats[logFnc]++
      await this.#setDB('all_group_member', this.#all_group_member, 0)
    }
  }

  async #setUserOrGroupStats (user_id, group_id) {
    if (user_id) {
      const user = this.#today_user_data.user
      if (!user[user_id]) {
        user[user_id] = 0
        this.#stats.user_count++
      }
      user[user_id]++

      if (!this.#all_user[user_id]) {
        this.#all_user.total++
        this.#user_increase.push(user_id)
        this.#all_user[user_id] = {
          receive_msg_count: 0,
          send_msg_count: 0,
          call_stats: {
            total: 0
          }
        }
        await this.#setDB('user_increase', this.#user_increase, 1)
      }
      this.#all_user[user_id].receive_msg_count++
      await this.#setDB('all_user', this.#all_user, 0)
    }

    if (group_id) {
      const group = this.#today_user_data.group
      if (!group[group_id]) {
        group[group_id] = 0
        this.#stats.group_count++
      }
      group[group_id]++

      if (!this.#all_group[group_id]) {
        this.#all_group.total++
        this.#all_group[group_id] = {
          receive_msg_count: 0,
          send_msg_count: 0,
          call_stats: {
            total: 0
          }
        }
      }
      this.#all_group[group_id].receive_msg_count++
      await this.#setDB('all_group', this.#all_group, 0)
    }

    if (user_id && group_id) {
      if (!this.#all_group_member[group_id]) {
        this.#all_group_member[group_id] = {
          total: 0
        }
      }
      if (!this.#all_group_member[group_id][user_id]) {
        this.#all_group_member[group_id].total++
        this.#all_group_member[group_id][user_id] = {
          receive_msg_count: 0,
          send_msg_count: 0,
          call_stats: {
            total: 0
          }
        }
      }
      this.#all_group_member[group_id][user_id].receive_msg_count++
      await this.#setDB('all_group_member', this.#all_group_member, 0)
    }

    await this.#setDB('user_group_stats', this.#today_user_data, 2)
  }

  async #getDB (key, date = this.#today) {
    return await this.db.get(`${key}${date ? `:${date}` : ''}`)
  }

  /**
   * 计算过期时间存入level
   * @param {string} key
   * @param {*} data
   */
  async #setDB (key, data, time = 1, date = this.#today) {
    await this.db.set(`${key}${time ? `:${date}` : ''}`, data, time)
  }
}

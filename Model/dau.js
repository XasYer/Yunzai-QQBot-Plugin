import _ from 'lodash'
import fs from 'node:fs'
import moment from 'moment'
import { join } from 'node:path'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'

//! 需顺序
const dauAttr = {
  msg_count: '上行消息量',
  send_count: '下行消息量',
  user_count: '上行消息人数',
  group_count: '上行消息群数',
  group_increase_count: '新增群数',
  group_decrease_count: '减少群数',
  user_cache: '用户缓存',
  group_cache: '群组缓存',
  time: '时间'
}
// 硬核
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

class Dau {
  async stat (uin, dau, pro) {
    let msg = [dau.time, ...this.toDauMsg(dau), '']

    const path = join(_path, 'data', 'QQBotDAU', uin)
    const today = moment().format('YYYY-MM-DD')
    const yearMonth = moment(today).format('YYYY-MM')
    // 昨日DAU
    try {
      let yesterdayDau = JSON.parse(fs.readFileSync(join(path, `${yearMonth}.json`), 'utf8'))
      yesterdayDau = _.find(yesterdayDau, v => moment(v.time).isSame(moment(today).subtract(1, 'd')))
      msg.push(...[yesterdayDau.time, ...this.toDauMsg(yesterdayDau), ''])
    } catch (error) { }

    // 最近30天平均
    let totalDAU = {
      user_count: 0,
      group_count: 0,
      msg_count: 0,
      send_count: 0
    }
    let days = 0
    try {
      let days30 = [yearMonth, moment(yearMonth).subtract(1, 'm').format('YYYY-MM')]
      days30 = _(days30).map(v => {
        let file = join(path, `${v}.json`)
        return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).reverse() : []
      }).flatten().take(30).value()

      days = days30.length
      totalDAU = _.mapValues(totalDAU, (v, k) => _.floor(_.meanBy(days30, k)))
    } catch (error) { }

    days = numToChinese[days] || days
    msg.push(...[`最近${days}天平均`, ...this.toDauMsg(totalDAU, 4)])
    msg = msg.join('\n')

    if (pro) {
      if (!fs.existsSync(path)) return false
      let daus = fs.readdirSync(path)

      if (_.isEmpty(daus)) return false
      let data = _.fromPairs(daus.map(v => [v.replace('.json', ''), JSON.parse(fs.readFileSync(`${path}/${v}`))]))
      data = this.monthlyDau(daus, path)

      totalDAU.days = days
      let renderdata = {
        daus: JSON.stringify(data),
        totalDAU,
        todayDAU: dau,
        monthly: _.keys(data).reverse(),
        nickname: Bot[uin].nickname,
        avatar: Bot[uin].avatar,
        tplFile: `${_path}/plugins/QQBot-Plugin/resources/html/DAU/DAU.html`,
        pluResPath: `${_path}/plugins/QQBot-Plugin/resources/`,
        _res_Path: `${_path}/plugins/genshin/resources/`
      }

      let img = await puppeteer.screenshot('DAU', renderdata)
      if (!img) return false
      msg = img
    }

    return msg
  }

  /**
   * 月度统计
   * @param {object} dat
   * @returns
   */
  monthlyDau (data) {
    const convertChart = (type, day, prefix = '') => {
      let chartData = { time: day.time }
      chartData[`${prefix}name`] = dauAttr[`${type}_count`]
      chartData[`${prefix}name`] = dauAttr[`${type}_count`]
      return chartData
    }

    data = _.mapValues(data, v => {
      let coldata = []
      let linedata = []
      _.each(v, day => {
        coldata.push(convertChart('user', day), convertChart('group', day))
        linedata.push(convertChart('msg', day, 'line'), convertChart('send', day, 'line'))
      })
      return [linedata, coldata]
    })

    return data
  }

  toDauMsg (dau, num = 0) {
    const msg = []
    _.each(dauAttr, (v, k) => {
      msg.push(`${v}：${dau[k]}`)
    })
    return num ? _.take(msg, num) : msg
  }

  getDau (data) {
    _.keys(dauAttr).forEach(v => {
      if (!data[v]) {
        if (['user_cache', 'group_cache'].includes(v)) data[v] = {}
        else data[v] = 0
      }
    })
    return data
  }

  async setDau (data, type, dau) {
    const uin = data.self_id
    const key = `${type}:${uin}`
    switch (type) {
      case 'send_count':
        dau.send_count++
        this.setRedis(`DAU:${key}`, dau.send_count)
        break
      case 'msg_count':
        dau.msg_count++
        this.setRedis(`DAU:${key}`, dau.msg_count)
        _.each(['group', 'user'], v => {
          let id = data[`${v}_id`]
          if (id && !dau[`${v}_cache`][id]) {
            dau[`${v}_cache`][id] = 1
            dau[`${v}_count`]++
            this.setRedis(`DAU:${uin}`, dau)
          }
        })
        break
      case 'group_increase_count':
      case 'group_decrease_count':
        let list = JSON.parse(await redis.get(`QQBot:${key}`)) || {}
        if (!list[data.group_id]) {
          dau[type]++
          this.setRedis(`DAU:${uin}`, dau)
          list[data.group_id] = 1
          this.setRedis(`:${key}`, list)
        }
        break
    }
    return dau
  }

  /**
   * 计算过期时间存入redis
   * @param {string} key
   * @param {*} data
   */
  setRedis (key, data) {
    const time = moment().add(1, 'd').format('YYYY-MM-DD 00:00:00')
    const EX = moment(time).diff(moment(), 's')
    redis.set(`QQBot${key}`, JSON.stringify(data), { EX })
  }
}

export default new Dau()

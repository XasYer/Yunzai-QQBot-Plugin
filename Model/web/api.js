import fs from 'fs'
import { join } from 'path'
import _ from 'lodash'

export async function getDauChartData (uin) {
  const data = Bot[uin].dau
  const stats = await data.getStats()
  return [
    {
      name: '今日活跃用户',
      value: stats.user_count
      // TODO: 成长百分比
      // percent: ''
      // TODO: 近期数据
    //   data: [stats.user_count]
    },
    {
      name: '今日活跃群数',
      value: stats.group_count
    //   data: [stats.group_count]
    },
    {
      name: '接收消息数量',
      value: stats.receive_msg_count
    //   data: [stats.receive_msg_count]
    },
    {
      name: '发送消息数量',
      value: stats.send_msg_count
    //   data: [stats.send_msg_count]
    }
  ]
}

export async function getWeekChartData (uin) {
  const dau = Bot[uin].dau
  const path = join(process.cwd(), 'data', 'QQBotDAU', uin)
  if (!fs.existsSync(path)) return []
  let daus = fs.readdirSync(path)// .reverse().slice(0, 2)
  if (_.isEmpty(daus)) return false
  let data = _.fromPairs(daus.map(v => [v.replace('.json', ''), JSON.parse(fs.readFileSync(`${path}/${v}`))]))
  data = dau.monthlyDau(Object.values(data).flat().slice(-30))
  const userData = []
  const groupData = []
  const weekData = []
  data.coldata[1].forEach((v, i) => {
    if (i % 2 === 0) {
      userData.push(v.count)
      weekData.push(v.time)
    } else {
      groupData.push(v.count)
    }
  })
  return [
    {
      userData: userData.slice(0, 7),
      groupData: groupData.slice(0, 7),
      weekData: weekData.slice(0, 7)
    },
    {
      userData,
      groupData,
      weekData
    }
  ]
}

export async function getcallStat (uin) {
  const dau = Bot[uin].dau
  const callStat = _.entries(dau.call_stats).sort((a, b) => b[1] - a[1])
  const data = await dau.callStat(callStat, true)
  return data.group.map(i => ({
    num: i.num,
    percentage: i.percent.replace('%', ''),
    color: i.color,
    name: i.name.replace(/^\[(.*)\]$/, '$1'),
    value: i.num
  }))
}

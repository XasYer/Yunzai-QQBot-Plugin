import fs from 'fs'
import { join } from 'path'
import _ from 'lodash'

export async function getDauChartData (uin) {
  const data = Bot[uin].dau
  const stats = await data.getStats()
  return [
    {
      name: '今日活跃用户',
      value: stats.user_count,
      total: data.dauDB === 'level' ? data.all_user?.total : Bot[uin].fl.size
      // TODO: 成长百分比
      // percent: ''
      // TODO: 近期数据
      //   data: [stats.user_count]

    },
    {
      name: '今日活跃群数',
      value: stats.group_count,
      total: data.dauDB === 'level' ? data.all_group?.total : Bot[uin].gl.size
    },
    {
      name: '接收消息数量',
      value: stats.receive_msg_count
    },
    {
      name: '发送消息数量',
      value: stats.send_msg_count
    },
    {
      name: '新增群数',
      value: stats.group_increase_count
    },
    {
      name: '减少群数',
      value: stats.group_decrease_count
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
  const receiveMsgData = []
  const sendMsgData = []
  data.coldata[1].forEach((v, i) => {
    if (i % 2 === 0) {
      userData.push(v.count)
      weekData.push(v.time)
    } else {
      groupData.push(v.count)
    }
  })
  data.linedata[0].forEach((v, i) => {
    if (i % 2 === 0) {
      receiveMsgData.push(v.linecount)
    } else {
      sendMsgData.push(v.linecount)
    }
  })
  return [
    {
      userData: userData.slice(userData.length - 7, userData.length),
      groupData: groupData.slice(groupData.length - 7, groupData.length),
      weekData: weekData.slice(weekData.length - 7, weekData.length),
      receiveMsgData: receiveMsgData.slice(receiveMsgData.length - 7, receiveMsgData.length),
      sendMsgData: sendMsgData.slice(sendMsgData.length - 7, sendMsgData.length)
    },
    {
      userData,
      groupData,
      weekData,
      receiveMsgData,
      sendMsgData
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

export async function getRedisKeys (sep = ':') {
  function addKeyToTree (tree, parts, fullKey) {
    if (parts.length === 0) return

    const [firstPart, ...restParts] = parts
    let node = tree.find((item) => item.label === firstPart)

    const currentKey = fullKey ? `${fullKey}:${firstPart}` : firstPart

    if (!node) {
      node = {
        label: firstPart,
        key: currentKey,
        children: []
      }
      tree.push(node)
    }

    addKeyToTree(node.children, restParts, currentKey)
  }
  const keysTree = []
  let cursor = '0'
  do {
    const res = await redis.scan(cursor, { MATCH: '*', COUNT: 10000 })
    cursor = res.cursor
    const keys = res.keys

    keys.forEach(key => {
      const parts = key.split(sep)
      addKeyToTree(keysTree, parts, '')
    })
  } while (cursor != 0)

  return keysTree
}

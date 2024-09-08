import { config } from '../config.js'
import { randomUUID } from 'node:crypto'
import { getDauChartData, getWeekChartData, getcallStat } from './api.js'

const path = '/qqbot'
const corsOptions = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'X-Requested-With,content-type,authorization',
  'Access-Control-Allow-Credentials': true
}

Bot.express.options(path + '/*', (req, res) => {
  res.set(corsOptions)
  res.sendStatus(200)
})

const token = {}

const route = [
  {
    url: '/login',
    method: 'post',
    response: ({ body }) => {
      const { username: uin, password } = body
      const bot = Bot[uin]
      if (!bot) {
        return {
          message: 'Bot不存在'
        }
      }
      if (bot.adapter.name !== 'QQBot') {
        return {
          message: '不是 QQBot 适配器'
        }
      }
      const p = config.web.password[uin] || config.web.password.default
      if (p !== password) {
        return {
          message: '密码错误'
        }
      }
      token[uin] = randomUUID()
      return {
        success: true,
        data: {
          avatar: bot.avatar,
          username: 'admin',
          nickname: bot.nickname,
          roles: ['admin'],
          accessToken: token[uin] + '.' + uin,
          refreshToken: token[uin] + ':refreshToken.' + uin,
          expires: '2030/10/30 00:00:00'
        }
      }
    }
  },
  {
    url: '/get-async-routes',
    method: 'get',
    response: () => {
      return {
        success: true,
        data: []
      }
    }
  },
  {
    url: '/getHomeData',
    method: 'post',
    response: async ({ body: { token } }) => {
      const [accessToken, uin] = token.split('.')
      return {
        success: true,
        data: {
          chartData: await getDauChartData(uin),
          weekData: await getWeekChartData(uin),
          callStat: await getcallStat(uin)
        }
      }
    }
  }
]
for (const i of route) {
  Bot.express[i.method](path + i.url, async (req, res) => {
    const result = await i.response(req)
    res.setHeader('Content-Type', 'application/json')
    res.set(corsOptions)
    res.status(200).send(JSON.stringify(result))
  })
}

import { config, configSave } from '../config.js'
import { randomUUID } from 'node:crypto'
import { getDauChartData, getWeekChartData, getcallStat } from './api.js'

const path = '/qqbot'
const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'X-Requested-With,content-type,authorization',
  'Access-Control-Allow-Credentials': true
}

Bot.express.use(path + '/*', (req, res, next) => {
  res.set(corsOptions)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
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
          expires: '2030/10/30 00:00:00',
          uin: Number(uin)
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
    url: '/get-home-data',
    method: 'post',
    token: true,
    response: async ({ body: { uin } }) => {
      return {
        success: true,
        data: {
          chartData: await getDauChartData(uin),
          weekData: await getWeekChartData(uin),
          callStat: await getcallStat(uin)
        }
      }
    }
  },
  {
    url: '/get-setting-data',
    method: 'post',
    token: true,
    response: () => {
      let maxRetry = config.bot.maxRetry
      if (maxRetry === Infinity) {
        maxRetry = 0
      }
      return {
        success: true,
        data: {
          ...config,
          bot: {
            ...config.bot,
            maxRetry
          }
        }
      }
    }
  },
  {
    url: '/set-setting',
    method: 'post',
    token: true,
    response: async ({ body }) => {
      const { data } = body
      if (data.bot.maxRetry === 0) {
        data.bot.maxRetry = Infinity
      }
      for (const key in data) {
        config[key] = data[key]
      }
      try {
        await configSave()
        return {
          success: true
        }
      } catch (error) {
        return {
          success: false,
          message: error.message
        }
      }
    }
  }
]
for (const i of route) {
  Bot.express[i.method](path + i.url, async (req, res) => {
    try {
      if (i.token) {
        const { token: t } = req.body
        const [accessToken, uin] = t?.split('.') || []
        if (!token[uin] && accessToken !== token[uin]) {
          res.status(401).send('Unauthorized')
          return
        }
        req.body.uin = String(uin)
      }
      const result = await i.response(req)
      res.setHeader('Content-Type', 'application/json')
      res.status(200).send(JSON.stringify(result))
    } catch (error) {
      res.status(500).send(error.message)
    }
  })
}

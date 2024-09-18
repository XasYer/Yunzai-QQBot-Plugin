import { config, configSave } from '../config.js'
import { randomUUID } from 'node:crypto'
import { getDauChartData, getWeekChartData, getcallStat, getRedisKeys } from './api.js'
import moment from 'moment'

const path = '/qqbot'
const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'X-Requested-With,content-type,authorization',
  'Access-Control-Allow-Credentials': true
}

Bot.express.use(path + '/*', (req, res, next) => {
  res.set(corsOptions)
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
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
  },
  {
    url: '/get-redis-info',
    method: 'post',
    token: true,
    response: async () => {
      const data = await redis.info()
      const redisInfo = {}
      data.split('\n').forEach(line => {
        if (line && !line.startsWith('#') && line.includes(':')) {
          const index = line.indexOf(':')
          const key = line.substring(0, index)
          const value = line.substring(index + 1)
          redisInfo[key.trim()] = value.trim()
        }
      })
      const duration = moment.duration(redisInfo.uptime_in_seconds, 'seconds')
      const days = Math.floor(duration.asDays())
      const hours = duration.hours()
      const minutes = duration.minutes()
      const secs = duration.seconds()
      const time = `${days}天${hours}时${minutes}分${secs}秒`
      redisInfo.uptime_formatted = time
      return {
        success: true,
        data: redisInfo
      }
    }
  },
  {
    url: '/get-redis-keys',
    method: 'post',
    token: true,
    response: async ({ body }) => {
      const { sep } = body
      const keys = await getRedisKeys(sep)
      return {
        success: true,
        data: keys
      }
    }
  },
  {
    url: '/get-redis-value',
    method: 'post',
    token: true,
    response: async ({ body }) => {
      const { key } = body
      const value = await redis.get(key)
      const expire = await redis.ttl(key)
      return {
        success: true,
        data: {
          key,
          value,
          expire
        }
      }
    }
  },
  {
    url: '/set-redis-value',
    method: 'post',
    token: true,
    response: async ({ body: { key, value, newKey, expire } }) => {
      if (newKey) {
        await redis.rename(key, newKey)
        key = newKey
      }
      if (expire === -2) {
        await redis.sendCommand(['GETSET', key, value])
      } else if (expire === -1) {
        await redis.set(key, value)
      } else {
        await redis.set(key, value, { EX: expire })
      }
      return {
        success: true,
        data: {
          key,
          value
        }
      }
    }
  },
  {
    url: '/delete-redis-keys',
    method: 'post',
    token: true,
    response: async ({ body }) => {
      const { keys } = body
      const errorKeys = []
      const successKeys = []
      for (const key of keys) {
        try {
          await redis.del(key)
          successKeys.push(key)
        } catch (error) {
          logger.error(error)
          errorKeys.push(key)
        }
      }
      return {
        success: true,
        data: {
          errorKeys,
          successKeys
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
      console.log('error', error)
      res.status(500).send(error.message)
    }
  })
}

import { config } from './config.js'

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
      return {
        success: true,
        data: {
          avatar: bot.avatar,
          username: 'admin',
          nickname: bot.nickname,
          roles: ['admin'],
          accessToken: 'eyJhbGciOiJIUzUxMiJ9.admin',
          refreshToken: 'eyJhbGciOiJIUzUxMiJ9.adminRefresh',
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
        code: 200,
        success: true,
        data: []
      }
    }
  }
]
for (const i of route) {
  Bot.express[i.method](path + i.url, (req, res) => {
    const result = i.response(req)
    res.setHeader('Content-Type', 'application/json')
    res.set(corsOptions)
    res.status(200).send(JSON.stringify(result))
  })
}

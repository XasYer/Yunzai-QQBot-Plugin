import { config, configSave } from '../config.js'
import { randomUUID } from 'node:crypto'
import {
  getDauChartData,
  getWeekChartData,
  getcallStat,
  getRedisKeys,
  formatBytes,
  formatDuration,
  getPluginNum,
  executeCommand
} from './api.js'
import os from 'os'
import _ from 'lodash'
import fs from 'fs'

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
    url: '/get-system-info',
    method: 'post',
    token: true,
    response: async () => {
      // from yenai-plugin
      const si = await (async () => {
        try {
          return await import('systeminformation')
        } catch (error) {
          try {
            // 看看椰奶有没有
            return await import('../../../yenai-plugin/node_modules/systeminformation/lib/index.js')
          } catch (error) {
            return false
          }
        }
      }
      )()
      if (!si) {
        return {
          success: false,
          data: {}
        }
      }
      const {
        currentLoad: { currentLoad: cpuCurrentLoad },
        cpu: { manufacturer, speed, cores, brand },
        fullLoad,
        mem: { total, active, swaptotal, swapused }
      } = await si.get({
        currentLoad: 'currentLoad',
        cpu: 'manufacturer,speed,cores,brand',
        fullLoad: '*',
        mem: 'total,active,swaptotal,swapused'
      })

      const getColor = (value) => {
        if (value >= 90) {
          return '#d56565'
        } else if (value >= 70) {
          return '#FFD700'
        } else {
          return '#73a9c6'
        }
      }
      const ramCurrentLoad = Math.round((active / total).toFixed(2) * 100)
      const visual = [
        {
          title: 'CPU',
          value: Math.round(cpuCurrentLoad),
          color: getColor(cpuCurrentLoad),
          info: [
            `${manufacturer} ${cores}核 ${speed}GHz`,
            `CPU满载率 ${Math.round(fullLoad)}%`
          ]
        },
        {
          title: 'RAM',
          value: ramCurrentLoad,
          color: getColor(ramCurrentLoad),
          info: [
            `${formatBytes(active)} / ${formatBytes(total)}`
          ]
        }
      ]
      if (swaptotal) {
        const swapCurrentLoad = Math.round((swapused / swaptotal).toFixed(2) * 100)
        visual.push({
          title: 'SWAP',
          value: swapCurrentLoad,
          color: getColor(swapCurrentLoad),
          info: [
            `${formatBytes(swapused)} / ${formatBytes(swaptotal)}`
          ]
        })
      } else {
        visual.push({
          title: 'SWAP',
          value: 0,
          color: '',
          status: 'exception',
          info: ['没有获取到数据']
        })
      }

      const memory = process.memoryUsage()
      // 总共
      const rss = formatBytes(memory.rss)
      // 堆
      const heapTotal = formatBytes(memory.heapTotal)
      // 栈
      const heapUsed = formatBytes(memory.heapUsed)
      // 占用率
      const occupy = (memory.rss / (os.totalmem() - os.freemem())).toFixed(2) * 100

      visual.push({
        title: 'Node',
        value: Math.round(occupy),
        color: getColor(occupy),
        info: [
          `总 ${rss}`,
          `${heapTotal} | ${heapUsed}`
        ]
      })

      const { controllers } = await si.graphics()
      const graphics = controllers?.find(item =>
        item.memoryUsed && item.memoryFree && item.utilizationGpu
      )

      const info = []

      info.push({ key: '操作系统', value: `${os.type()} ${os.arch()}` })
      info.push({ key: '主机名称', value: os.hostname() })
      info.push({ key: '系统版本', value: os.release() })
      info.push({ key: '运行时间', value: formatDuration(os.uptime()) })
      info.push({ key: 'CPU', value: manufacturer && brand && `${manufacturer} ${brand}` })

      if (graphics) {
        const {
          vendor, temperatureGpu, utilizationGpu,
          memoryTotal, memoryUsed, model
        } = graphics
        visual.push({
          title: 'GPU',
          value: Math.round(utilizationGpu),
          color: getColor(utilizationGpu),
          info: [
            `${(memoryUsed / 1024).toFixed(2)}G / ${(memoryTotal / 1024).toFixed(2)}G`,
            `${vendor} ${temperatureGpu}°C`
          ]
        })
        info.push({ key: 'GPU', value: model })
      } else {
        visual.push({
          title: 'GPU',
          value: 0,
          color: '',
          status: 'exception',
          info: ['没有获取到数据']
        })
      }
      info.push({ key: '插件数量', value: getPluginNum() })

      try {
        const packageFile = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))
        info.push({ key: 'TRSS-Yunzai', value: packageFile.version })
      } catch (error) {

      }
      const { node, v8, git } = await si.versions('node,v8,git')

      info.push({ key: 'Node', value: node })
      info.push({ key: 'V8', value: v8 })
      info.push({ key: 'Git', value: git })

      const HardDisk = _.uniqWith(await si.fsSize(),
        (a, b) =>
          a.used === b.used && a.size === b.size && a.use === b.use && a.available === b.available
      ).filter(item => item.size && item.used && item.available && item.use)
      return {
        success: true,
        data: {
          visual,
          fsSize: HardDisk.map(item => {
            item.used = formatBytes(item.used)
            item.size = formatBytes(item.size)
            item.use = Math.round(item.use)
            item.color = getColor(item.use)
            return item
          }),
          info: info.filter(i => i.value)
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
      redisInfo.uptime_formatted = formatDuration(redisInfo.uptime_in_seconds)
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
      const { sep, lazy } = body
      const keys = await getRedisKeys(sep, lazy)
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

const terminalWsPath = 'qqbot-ws-terminal'

if (!Array.isArray(Bot.wsf[terminalWsPath])) { Bot.wsf[terminalWsPath] = [] }
Bot.wsf[terminalWsPath].push((ws, req, socket) => {
  let childProcess
  let isAuthenticated = false
  setTimeout(() => {
    if (!isAuthenticated) {
      ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }))
      ws.close()
    }
  }, 5000)
  ws.on('message', message => {
    let data
    try {
      data = JSON.parse(message)
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', success: false, content: 'Invalid message format' }))
      return
    }
    const { command, args, action, workingDirectory } = data
    if (!isAuthenticated && action !== 'create') return
    switch (action) {
      case 'execute':
        if (childProcess) {
          childProcess.kill('SIGINT')
        }
        childProcess = executeCommand(command, args, ws, workingDirectory)
        break
      // 中断命令
      case 'terminate':
        if (childProcess) {
          childProcess.kill('SIGINT') // 发送中断信号
          childProcess = null // 清除子进程引用
          ws.send(JSON.stringify({ type: 'terminated', content: '命令已中断' }))
        }
        break
      // 心跳
      case 'ping':
        ws.send(JSON.stringify({ type: 'ping', content: 'pong' }))
        break
      // 鉴权
      case 'create': {
        const [accessToken, uin] = command.split('.')
        if (accessToken !== token[uin]) {
          ws.send(JSON.stringify({ type: 'auth', success: false, content: 'Authentication failed' }))
          socket.destroy()
        } else {
          ws.send(JSON.stringify({ type: 'auth', success: true, content: 'Authentication success', path: process.cwd() }))
          isAuthenticated = true
        }
        break
      }
      default:
        break
    }
  })
  ws.on('close', () => {
    console.log('close')
    if (childProcess) {
      childProcess.kill('SIGINT')
      childProcess = null
    }
  })
  ws.on('error', () => {
    if (childProcess) {
      childProcess.kill('SIGINT')
      childProcess = null
    }
  })
})

import fs from 'fs'
import { fileURLToPath } from 'url'
import { getToken } from './login/index.js'
import { join, dirname, basename } from 'path'

const httpPath = '/qqbot'
const wsPath = 'qqbot'
const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'X-Requested-With,content-type,authorization',
  'Access-Control-Allow-Credentials': true
}

Bot.express.use(httpPath + '/*', (req, res, next) => {
  res.set(corsOptions)
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

const httpRoute = []
const wsRoute = []

async function loadRoutes (directory) {
  const items = fs.readdirSync(directory)

  for (const item of items) {
    const fullPath = join(directory, item)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      await loadRoutes(fullPath)
    } else if (stat.isFile() && item === 'index.js' && basename(dirname(fullPath)) !== 'web') {
      try {
        const { http, ws } = (await import(`file://${fullPath}`)).default
        if (http?.length) {
          httpRoute.push(...http)
        }
        if (ws?.length) {
          wsRoute.push(...ws)
        }
      } catch (error) {
        console.log('error', error)
      }
    }
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

await loadRoutes(__dirname)

if (!Array.isArray(Bot.wsf[wsPath])) { Bot.wsf[wsPath] = [] }

for (const i of httpRoute) {
  Bot.express[i.method](httpPath + i.url, async (req, res) => {
    try {
      if (i.token) {
        const { token: t } = req.body
        const [accessToken, uin] = t?.split('.') || []
        if (!getToken(uin) && accessToken !== getToken(uin)) {
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
for (const i of wsRoute) {
  Bot.wsf[wsPath].push((ws, req, socket, head) => {
    const url = req.url.replace(`/${wsPath}`, '')
    if (url === `/ws${i.url}`) i.function(ws, req, socket, head)
  })
}

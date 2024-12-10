import fs from 'fs'
import _ from 'lodash'
import Fastify from 'fastify'
import nodeForge from 'node-forge'
import { config } from './config.js'
import fastifyWebSocket from '@fastify/websocket'
import { getKeyPairMap, getUinMap, setKeyPairMap } from './cache.js'

export const runServer = async (onMessage, fastify = null) => {
  if (fastify) {
    await fastify.close()
  }
  if (!config.webhook.port) {
    return false
  }
  const https = ['key', 'cert', 'ca'].reduce((acc, key) => {
    if (config.webhook?.ssl?.[key]) {
      acc[key] = fs.readFileSync(config.webhook.ssl[key])
    }
    return acc
  }, {})
  fastify = Fastify({
    https: _.isEmpty(https) ? undefined : https
  })

  await fastify.register(fastifyWebSocket)

  // 为什么INTERACTION_CREATE事件的body.toString()之后的JSON字符串有空格??????????????????????????????
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      req.rawBody = body
      done(null, JSON.parse(body.toString()))
    } catch (err) {
      done(err)
    }
  })

  fastify.post(config.webhook.path || '/', async (req, reply) => {
    const end = () => reply.send({ op: 12 })
    // 没有body
    if (_.isEmpty(req.body)) {
      return end()
    }
    const appid = req.headers['x-bot-appid']
    // 请求头没有appid
    if (!appid) {
      return end()
    }
    const uin = getUinMap(appid)
    // 没有缓存uin
    if (!uin) {
      return false
    }
    const bot = Bot[uin]
    // bot不存在
    if (!bot) {
      return false
    }
    const secret = bot.privacy().secret
    // 没有secret
    if (!secret) {
      return end()
    }
    const body = req.body
    switch (body.op) {
      case 0: {
        if (config.webhook.signature) {
          const time = req.headers['x-signature-timestamp']
          const ed25519 = req.headers['x-signature-ed25519']
          // 没有时间戳或签名
          if (!time || !ed25519) {
            return end()
          }
          const signature = Buffer.from(ed25519, 'hex')

          // 检查签名长度是否为 64 字节 以及 签名的最后一位的高 3 位是否为 0
          if (signature.length !== 64 || (signature[63] & 224) !== 0) {
            return end()
          }

          const keyPair = getKeyPair(appid, secret)

          const msg = Buffer.concat([Buffer.from(time), req.rawBody])

          // 验证签名
          const isValid = nodeForge.pki.ed25519.verify({ message: msg, signature, publicKey: keyPair.publicKey })
          if (!isValid) {
            return end()
          }
        }
        onMessage(uin, body)
        return end()
      }
      // 配置webhook验证
      case 13: {
        const keyPair = getKeyPair(appid, secret)

        const msg = `${body.d.event_ts}${body.d.plain_token}`

        const signature = nodeForge.pki.ed25519.sign({
          message: Buffer.from(msg),
          privateKey: keyPair.privateKey
        })

        const signatureHex = Buffer.from(signature).toString('hex')

        return reply.send({
          plain_token: body.d.plain_token,
          signature: signatureHex
        })
      }
      default: {
        return end()
      }
    }
  })

  fastify.addHook('onError', (error, req, reply) => {
    logger.error('[QQBot-Plugin:Webhook-Server]', error)
  })

  fastify.listen({ port: 8443, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      logger.error('[QQBot-Plugin:Webhook-Server-listen]', err)
    } else {
      logger.info('[QQBot-Plugin:Webhook-Server-listen]', `Server running at ${address}`)
    }
  })

  return fastify
}

function getKeyPair (appid, secret) {
  let keyPair = getKeyPairMap(appid)
  if (keyPair) {
    return keyPair
  }
  const ed25519 = nodeForge.pki.ed25519
  const seed = secret.padEnd(32, secret).slice(0, 32)
  keyPair = ed25519.generateKeyPair({ seed })
  setKeyPairMap(appid, keyPair)
  return keyPair
}

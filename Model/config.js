import makeConfig from '../../../lib/plugins/config.js'
import YAML from 'yaml'
import fs from 'node:fs'

let { config, configSave } = await makeConfig('QQBot', {
  tips: '',
  permission: 'master',
  webhook: {
    port: 0,
    path: '/webhook',
    signature: true,
    ssl: {
      key: '',
      cert: '',
      ca: ''
    },
    ws: { }
  },
  toCallback: true,
  toBotUpload: true,
  toImg: true,
  callStats: false,
  markdown: {
    template: 'abcdefghij'
  },
  sendButton: true,
  customMD: {},
  mdSuffix: {},
  btnSuffix: {},
  filterLog: {},
  markdownImgScale: 1.0,
  sep: '',
  bot: {
    timeout: 30000
  },
  token: []
}, {
  tips: [
    '欢迎使用 TRSS-Yunzai QQBot Plugin ! 作者：时雨🌌星空 & 小叶',
    '参考：https://github.com/XasYer/Yunzai-QQBot-Plugin'
  ]
})

function refConfig () {
  config = YAML.parse(fs.readFileSync('config/QQBot.yaml', 'utf-8'))
}

export {
  config,
  configSave,
  refConfig
}

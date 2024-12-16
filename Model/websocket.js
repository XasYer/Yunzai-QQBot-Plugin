import WS from 'ws'

export class WebSocket {
  constructor (onMessage, id, url, reconnectInterval = 5000, reconnectAttempts = 5, heartbeatInterval = 30000) {
    this.onMessage = onMessage
    this.id = id
    this.url = url
    this.reconnectInterval = reconnectInterval
    this.reconnectAttempts = reconnectAttempts
    this.heartbeatInterval = heartbeatInterval
    this.ws = null
    this.reconnectCount = 0
    this.timer = null
    this.connect()
  }

  connect () {
    this.ws = new WS(this.url)
    this.ws.on('open', () => {
      this.reconnectCount = 0
      clearInterval(this.timer)
      this.timer = setInterval(() => {
        this.ws.ping()
      }, this.heartbeatInterval)
    })
    this.ws.on('message', (data) => {
      try {
        this.onMessage(this.id, JSON.parse(data))
      } catch (error) {
        Bot.makeLog('error', ['中转WebSocket数据解析失败', error], this.id)
      }
    })
    this.ws.on('close', () => {
      Bot.makeLog('mark', '中转WebSocket连接已关闭', this.id)
      if (this.reconnectCount < this.reconnectAttempts || this.reconnectAttempts <= 0) {
        Bot.makeLog('mark', `中转WebSocket将在${this.reconnectInterval / 1000}秒后尝试重连第${this.reconnectCount + 1}次`, this.id)
        setTimeout(() => {
          this.reconnectCount++
          this.connect()
        }, this.reconnectInterval)
      } else {
        Bot.makeLog('mark', '中转WebSocket重连失败，已达到最大重连次数', this.id)
      }
    })
    this.ws.on('error', (error) => {
      Bot.makeLog('error', ['中转WebSocket连接出错', error], this.id)
    })
  }
}

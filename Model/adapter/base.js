export default class base {
  constructor ({ config, entry }) {
    this.cfg = config
    this.entry = entry
    this.sep = this.entry.sep
  }

  get baseType () {
    return {
      // 好友私聊
      private: {
        type: 'Private',
        name: '好友',
        id: 'user_id'
      },
      // 群消息
      group: {
        type: 'Group',
        name: '群',
        id: 'group_id'

      },
      // 频道私聊
      direct: {
        type: 'Direct',
        name: '频道私聊',
        id: 'guild_id'
      },
      // 频道消息
      guild: {
        type: 'Guild',
        name: '频道',
        id: 'channel_id'
      }
    }
  }

  get userCache () {
    return this.entry.userCache
  }

  /**
   * sdk调用
   * @param {'private'|'group'|'direct'|'guild'} type 消息来源
   * @param {string} prefix 函数名前缀
   * @param {object} data e
   * @param  {...any} args 函数参数
   * @returns
   */
  sdkCaller (type, prefix, data, ...args) {
    type = this.baseType[type]
    let fnName = `${prefix}${type.type}`

    let suffix = 'Message'
    let id = data[type.id]
    id = id.replace(`${data.self_id}${this.sep}`, '')

    if (fnName === 'createDirect') {
      suffix = 'Session'
      id = data.src_guild_id
    }

    fnName += suffix
    return data.bot.sdk[fnName](id, ...args)
  }
}

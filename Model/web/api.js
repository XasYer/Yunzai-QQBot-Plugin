export function getDauChartData (uin) {
  const data = Bot[uin].dau
  const stats = data.getProp('stats')
  return [
    {
      name: '今日活跃用户',
      value: stats.user_count
      // TODO: 成长百分比
      // percent: ''
      // TODO: 近期数据
    //   data: [stats.user_count]
    },
    {
      name: '今日活跃群数',
      value: stats.group_count
    //   data: [stats.group_count]
    },
    {
      name: '接收消息数量',
      value: stats.receive_msg_count
    //   data: [stats.receive_msg_count]
    },
    {
      name: '发送消息数量',
      value: stats.send_msg_count
    //   data: [stats.send_msg_count]
    }
  ]
}

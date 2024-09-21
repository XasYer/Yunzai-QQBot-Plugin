import moment from 'moment'

export function formatDuration (inp, unit = 'seconds') {
  const duration = moment.duration(inp, unit)

  const days = duration.days()
  const hours = duration.hours()
  const minutes = duration.minutes()
  const secs = duration.seconds()

  let formatted = ''
  if (days > 0) formatted += `${days}天`
  if (hours > 0) formatted += `${hours}时`
  if (minutes > 0) formatted += `${minutes}分`
  if (secs > 0 || formatted === '') formatted += `${secs}秒`

  return formatted.trim()
}

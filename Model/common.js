import { join } from 'path'
import { randomUUID } from 'node:crypto'

/**
 * 获得指定日期的日期字符串
 * @param {number} day 相较于今天的日期天数，正数表示未来日期，负数表示过去日期
 * @returns yyyy-mm-dd
 */
function getTime (day = 0) {
  const now = new Date()
  now.setHours(now.getHours() + 8)
  if (day != 0) now.setDate(now.getDate() + day)
  return now.toISOString().split('T').shift()
}

/**
 * 动态导入js文件
 * @param {string} path plusins/QQBot-Plugin/之后的路径
 * @param {string} funcOrVarName 指定要导入的函数或变量名
 * @returns 导入的函数或变量
 */
async function importJS (path, funcOrVarName) {
  try {
    const module = await import('file://' + join(process.cwd(), 'plugins', 'QQBot-Plugin', path))
    return funcOrVarName ? module[funcOrVarName] : module
  } catch (error) {
    return false
  }
}

/**
 * 分割MD模版参数
 * @param {*} text 需要分割的字符串
 * @returns 分割后的数组
 */
function splitMarkDownTemplate (text) {
  const rand = randomUUID()
  const regexList = [
    /(!?\[.*?\])(\s*\(.*?\))/,
    /(\[.*?\])(\[.*?\])/,
    /(\*)([^*]+?\*)()/,
    /(`)([^`]+?`)()/,
    /(_)([^_]*?_)()/,
    /(~)(~)/,
    /^(#)()/,
    /(``)(`)/
  ]
  for (const reg of regexList) {
    for (const match of text.match(new RegExp(reg, 'g')) || []) {
      const tmp = reg.exec(match)
      text = text.replace(tmp[0], tmp.slice(1).join(rand))
    }
  }
  return text.split(rand)
}

function getMustacheTemplating (template, context) {
  try {
    // eslint-disable-next-line no-new-func
    const func = new Function('context', `
      with(context) {
        return \`${template.replace(/\{\{([^}]+)\}\}/g, '${$1}')}\`;
      }
    `)
    return func(context).replace(/\n/g, '\r')
  } catch (error) {
    logger.error(`getMustacheTemplating error: ${error}`)
    return ''
  }
}

export {
  getTime,
  importJS,
  splitMarkDownTemplate,
  getMustacheTemplating
}

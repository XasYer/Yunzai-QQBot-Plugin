import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ulid } from 'ulid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pluginPath = join(__dirname, '..')

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
    const module = await import('file://' + join(pluginPath, path))
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
  const rand = ulid()
  const regexList = [
    /(!?\[.*?\])(\s*\(.*?\))/g,
    /(\[.*?\])(\[.*?\])/g,
    /(\*)([^*]+?\*)/g,
    /(`)([^`]+?`)/g,
    /(_)([^_]*?_)/g,
    /(~)(~)/g,
    /^(#)/g,
    /(``)(`)/g
  ]

  regexList.forEach(reg => {
    text = text.replace(reg, (match, ...groups) => groups.slice(0, -2).join(rand))
  })

  return text.split(rand)
}

function getMustacheTemplating (template, context) {
  let func = null
  try {
    // eslint-disable-next-line no-new-func
    func = new Function('context', `
      with(context) {
        return \`${template.replace(/\{\{([^}]+)\}\}/g, '${$1}')}\`;
      }
    `)
    const result = func(context).replace(/\n/g, '\r')
    func = null
    return result
  } catch (error) {
    logger.error(`getMustacheTemplating error: ${error}`)
    return ''
  }
}

export {
  pluginPath,
  getTime,
  importJS,
  splitMarkDownTemplate,
  getMustacheTemplating
}

const uinMap = new Map()

/**
 * 设置uin和appid的映射
 * @param {string} appid
 * @param {string} uin
 * @returns
 */
export const setUinMap = (appid, uin) => uinMap.set(appid, uin)
/**
 * 根据appid获取uin
 * @param {string} appid
 * @returns {string}
 */
export const getUinMap = appid => uinMap.get(appid)

const keyPairMap = new Map()

/**
 * 设置appid和keyPair的映射
 * @param {*} appid
 * @param {*} keyPair
 * @returns
 */
export const setKeyPairMap = (appid, keyPair) => keyPairMap.set(appid, keyPair)

/**
 * 根据appid获取keyPair
 * @param {*} appid
 * @returns
 */
export const getKeyPairMap = appid => keyPairMap.get(appid)

import { Level } from 'level'
import schedule from 'node-schedule'

export default class level {
    constructor(path) {
        this.db = new Level(path, { valueEncoding: "json" })
        this.setSchedule()
    }

    async cleanup() {
        const today = this.getTime();

        for await (const [key, value] of this.db.iterator()) {
            try {
                if (value.expiredTime && new Date(value.expiredTime) < new Date(today)) {
                    await this.db.del(key);
                }
                // 清除一下旧数据
                if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
                    await this.db.del(key);
                }
            } catch (error) { }
        }
    }

    setSchedule() {
        // 每天00:00删除所有过期的key
        this.job = schedule.scheduleJob('0 0 0 * * ?', async () => {
            await this.cleanup();
        });
    }

    async open() {
        await this.db.open()
        await this.cleanup()
    }

    /**
     * 存储一个值
     * @param {string} key 
     * @param {any} value 
     * @param {number} time 几天之后过期(包含今天),为0时不会过期
     * @returns 
     */
    async set(key, value, time = 0) {
        if (!value) return
        let storedValue = value
        // 要存储的值不是object时，转换为object
        if (typeof storedValue !== 'object') {
            storedValue = {
                __originalValue: value
            }
        }

        // 如果有过期时间，则设置过期时间
        if (time > 0) {
            storedValue.expiredTime = this.getTime(time - 1)
        }

        await this.db.put(key, storedValue)
    }

    async get(key) {
        // 迁移redis旧数据
        let redisDate = await redis.get(key)
        if (redisDate) {
            redisDate = JSON.parse(redisDate)
            await redis.del(key)
            await this.set(key, redisDate, 1)
            return redisDate
        }
        try {
            let value = await this.db.get(key);
            // const expiredTime = value.expiredTime;
            // 检查是否需要转换回原始类型
            if (value.__originalValue) {
                value = value.__originalValue
            }
            if (value?.expiredTime) {
                // if (new Date(expiredTime) < new Date(this.getTime())) {
                //     // 如果当前日期晚于过期日期，则删除key
                //     await this.db.del(key);
                //     return null;
                // }
                // 过期时间不返回
                delete value.expiredTime;
            }
            return value;
        } catch (err) {
            // 不存在key
            if (err.notFound) {
                return null;
            }
            // 其他错误
            logger.error('[QQBot-Plugin] level', err);
            return null;
        }
    }

    close() {
        this.db.close();
    }

    getTime(day = 0) {
        const now = new Date();
        now.setHours(now.getHours() + 8);
        if (day > 0) now.setDate(now.getDate() + day);
        return now.toISOString().split('T').shift();
    }
}
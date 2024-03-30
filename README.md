<div align="center">

# TRSS-Yunzai QQBot Plugin

TRSS-Yunzai QQBot 适配器 插件

</div>

# Tip

建议使用TRSS原版,此版本为`个人自用`版,会在`任意时间`直接进行更改,且`不会`与TRSS一致

## 自用Fork版

1. 转发消息改为渲染成图片,需要安装`ws-plugin`
2. `#QQBot设置转换开启`配合`#ws绑定`实现互通数据
3. `#QQBotDAU` and `#QQBotDAUpro`
5. `QQBot-Plugin/Model`中`自定义入群发送主动消息`
6. `config/QQBot.yaml`中使用以下自定义模版,如果设置了全局md会优先使用自定义模版,配合`e.toQQBotMD = true`将特定消息`转换`成md,亦可在`全局md模式下`通过`e.toQQBotMD = false`将特定消息`不转换`成md
    - 方法1: 直接修改`config/QQBot.yaml` **(推荐)**
      ```yml
      customMD:
        BotQQ:
          custom_template_id: 模版id
          keys: 
            - key1 # 对应的模版key名字
            - key2
            # ... 最多10个
      ```
    - 方法2: 在`Model`目录下新建`markdownTemplate.js`文件,写入以下内容 **(不推荐)**
      ```js
      // params为数组,每一项为{key:string,values: ['\u200B']} // values固定为['\u200B']
      // split: 是否将md参数分割 比如 ![图片](链接) 会分成两个参数 ![图片] 和 (链接)
      export defalut {
        custom_template_id: '',
        params: [],
        split: true
      }
      ```
7. `config/QQBot.yaml`中`saveDBFile: false`是否使用基于文件的数据库
8. `#QQBot调用统计` 根据`e.reply()`发送的消息进行统计,每条消息仅统计一次,未做持久化处理,默认关闭,`#QQBot设置调用统计开启`
9. `config/QQBot.yaml`中使用以下配置项,在`全局MD`时会`以MD的模式`自动加入`消息最后`
    ```yml
    mdSuffix:
      BotQQ:
          - key: key
            values:
              - value # 如果用到了key则不会添加
          # ...
    ```
10. `config/QQBot.yaml`中使用以下配置项,在`全局MD`时会`以button的模式`自动加入`按钮指定行数并独占一行`,当`超过`5排按钮时`不会添加`
    ```yml
    btnSuffix:
      BotQQ:
        position: 1 # 位置:第几行 1 - 5
        values:
          - text: test
            callback: test
            show: # 达成什么条件才会显示
              type: random    # 目前仅支持 random
              data: 50        # 0-100
          - text: test2
            input: test2
          # ... 最多10个
    ```
11. `#QQBot用户统计`: 对比昨日的用户数据,默认关闭,`#QQBot设置用户统计开启`
12. `config/QQBot.yaml`中使用前台日志消息过滤（~~自欺欺人大法~~），将会不在前台打印自定的消息内容，防log刷屏（~~比如修仙、宝可梦等~~），也可以使用`#QQBot添加/删除过滤日志垃圾机器人` 
    - **自定义消息采取完整消息匹配，非关键词匹配**
    - **非必要不建议开启此项**
    > 注意：*只会过滤部分QQBot的日志*
    ```yml
    filterLog:
      BotQQ:
        - 垃圾机器人
        - 垃圾bot
        - 垃圾Bot
        # ...
      ```

## 安装教程

1. 准备：[TRSS-Yunzai](../../../Yunzai)
2. 输入：`#安装QQBot-Plugin`
3. 打开：[QQ 开放平台](https://q.qq.com) 创建 Bot：  
① 创建机器人  
② 开发设置 → 得到 `机器人QQ号:AppID:Token:AppSecret`  
4. 输入：`#QQBot设置机器人QQ号:AppID:Token:AppSecret:[01]:[01]`

## 格式示例

- 机器人QQ号 `114` AppID `514` Token `1919` AppSecret `810` 群Bot 频道私域

```
#QQBot设置114:514:1919:810:1:1
```

## 高阶能力

<details><summary>Markdown 消息</summary>

高阶能力 → 消息模板 → 添加 Markdown 模板

模板名称：多图文消息  
使用场景：发送连续图文消息  
Markdown 源码：

```
{{.a}}{{.b}}{{.c}}{{.d}}{{.e}}{{.f}}{{.g}}{{.h}}{{.i}}{{.j}}
```


配置模板参数
| 模板参数 | 参数示例 |
| - | - |
| a | 0 |
| b | 1 |
| c | 2 |
| d | 3 |
| e | 4 |
| f | 5 |
| g | 6 |
| h | 7 |
| i | 8 |
| j | 9 |

保存 → 提交审核 → 审核完成后，输入 `#QQBotMD机器人QQ号:模板ID`

</details>

## 使用教程

- #QQBot账号
- #QQBot设置 + `机器人QQ号:AppID:Token:AppSecret:是否群Bot:是否频道私域`（是1 否0）
- #QQBotMD + `机器人QQ号:模板ID`
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
6. `config/QQBot.yaml`中使用以下自定义模版,配合`e.toQQBotMD = true`将特定消息转换成md
    ```yml
    customMD:
      BotQQ:
        custom_template_id: 模版id
        keys: 
          - key1 # 对应的模版key名字
          - key2
    ```
7. `config/QQBot.yaml`中`saveDBFile: false`是否使用基于文件的数据库
8. `#QQBot调用统计` 根据`e.reply()`发送的消息进行统计,每条消息仅统计一次,未做持久化处理,默认关闭,`#QQBot设置调用统计开启`
9. `config/QQBot.yaml`中使用以下配置项,在`全局MD`时会`以MD的模式`自动加入`消息最后`
    ```yml
    mdSuffix:
      BotQQ:
          - key: key
            values:
              - value
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

## 发送文件（图片/语音/视频）

- 使用公网地址，填入 `config/config/bot.yaml:url`，浏览器打开 url，后台日志应显示访问请求
- 使用其他 Bot，如 [ICQQ](https://gitee.com/TimeRainStarSky/Yunzai-ICQQ-Plugin)

## 高阶能力

<details><summary>Markdown 消息</summary>

高阶能力 → 消息模板 → 添加 Markdown 模板

模板名称：图文消息  
使用场景：发送图文混排消息  
Markdown 源码：`{{.a}}{{.b}}`  

配置模板参数
| 模板参数 | 参数示例 |
| - | - |
| a | 开头文字![图片] |
| b | (https://qqminiapp.cdn-go.cn/open-platform/11d80dc9/img/robot.b167c62c.png)结束文字 |

保存 → 提交审核 → 审核完成后，输入 `#QQBotMD机器人QQ号:模板ID`

</details>

## 使用教程

- #QQBot账号
- #QQBot设置 + `机器人QQ号:AppID:Token:AppSecret:是否群Bot:是否频道私域`（是1 否0）
- #QQBotMD + `机器人QQ号:模板ID`
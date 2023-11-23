<div align="center">

# TRSS-Yunzai QQBot Plugin

TRSS-Yunzai QQBot 适配器 插件

[![访问量](https://visitor-badge.glitch.me/badge?page_id=TimeRainStarSky.Yunzai-QQBot-Plugin&right_color=red&left_text=访%20问%20量)](https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin)
[![Stars](https://img.shields.io/github/stars/TimeRainStarSky/Yunzai-QQBot-Plugin?color=yellow&label=收藏)](../../stargazers)
[![Downloads](https://img.shields.io/github/downloads/TimeRainStarSky/Yunzai-QQBot-Plugin/total?color=blue&label=下载)](../../archive/main.tar.gz)
[![Releases](https://img.shields.io/github/v/release/TimeRainStarSky/Yunzai-QQBot-Plugin?color=green&label=发行版)](../../releases/latest)

[![访问量](https://profile-counter.glitch.me/TimeRainStarSky-Yunzai-QQBot-Plugin/count.svg)](https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin)

</div>

## 自用fork版

1. 转发消息改为渲染成图片,需要安装`ws-plugin`

## 安装教程

1. 准备：[TRSS-Yunzai](../../../Yunzai)
2. 输入：`#安装QQBot-Plugin`
3. 打开：[QQ 开放平台](https://q.qq.com) 创建 Bot：  
① 创建机器人  
② 开发设置 → 得到 `机器人QQ号:AppID:Token:AppSecret`  
4. 输入：`#QQBot设置机器人QQ号:AppID:Token:AppSecret:[01]:[01]`
5. 公网地址填入 `config/config/bot.yaml:url`

## 格式示例

- 机器人QQ号 `114` AppID `514` Token `1919` AppSecret `810` 群Bot 频道私域

```
#QQBot设置114:514:1919:810:1:1
```

## 使用教程

- #QQBot账号
- #QQBot设置 + `机器人QQ号:AppID:Token:AppSecret:是否群Bot:是否频道私域`（是1 否0）

- 注意：
1. 需要公网地址，使用浏览器打开 url，后台日志应显示访问请求
# dsh-session-stars

[English](README.md) | 中文

给 DeepSeek Harness Web UI 工作区里的会话加上 1-5 星收藏，并用等级区分重要程度。

会话列表的每一行都会出现星级控件：给会话打 1 到 5 星，行内始终显示重要度徽标。评保存在宿主的 JSON 文件里，刷新页面、重启应用或 Web 服务端口变化都不会丢。

## 功能

- **1-5 星重要度**：1 星最低，5 星最关键。鼠标移到会话行上会出现星标按钮，点击后在该行旁弹出紧凑的星级选择器。
- **一眼看懂重要度**：会话行时间旁显示 `★ N`，按等级着色（1-2 星弱化、3 星品牌色、4 星琥珀色、5 星红色）；会话悬浮卡片里显示完整星级和等级名称。
- **宿主持久化**：评保存在 `~/.dsh/session-stars.json`（或 `$DSH_HOME/session-stars.json`），写入串行并原子发布。
- **智能体工具**：`session_stars` 让模型读取评级、设置星级或清除评级，与界面共用同一份数据。
- **中英双语**：简体中文和英文文案，其他语言回退英文。
- **主题原生**：选择器和徽标只使用 `--dsw-alias-*` 主题变量，亮色/暗色主题都能正常显示。

## 安装

本包是一个 DSH bundle（`dsh.bundle.patch`），通过插件管理器安装目录：

1. 让 DSH 智能体用 `plugin_manager` 的 `install_bundle` 安装本目录的绝对路径；
2. bundle 会以链接方式进入当前 profile 并即时生效；如果浏览器端没有马上出现，刷新 Web UI 页面即可。

宿主侧插入的行 id 是 `dsh-session-stars`，浏览器端由 `package.json` 的 `dsh.client` 声明。

## 使用

| 位置 | 行为 |
|---|---|
| 会话行悬浮按钮 | 点击星标按钮打开重要度选择器。 |
| 选择器 | 选 1-5 星，或清除评级；`Esc` 或点击外部关闭。 |
| 会话行尾部徽标 | 有评级时显示 `★ N`，颜色对应重要度。 |
| 会话悬浮卡片 | 完整星级 + 本地化等级名。 |
| 智能体工具 `session_stars` | `list` 读取、`set` 设置 1-5 星、`clear` 清除；省略 `sessionId` 时作用于当前会话。 |

等级：1 低、2 一般、3 重要、4 很重要、5 关键。

## 数据与接口

- 文件：`<DSH home>/session-stars.json`，格式 `{ "version": 1, "updatedAt": <ms>, "ratings": { "<sessionId>": { "stars": 1-5, "updatedAt": <ms> } } }`。
- 浏览器路由：`GET /session-stars` 读取全部评级，`POST /session-stars` 携带 `{ "sessionId": "...", "stars": 0-5 }` 写入一条。路由只接受同源请求，跨站 `Origin` 会被拒绝。
- 评级按会话 id 记录；删除会话不会自动删除评级，可在选择器里手动清除。
- 修改后当前窗口立即更新；其他已打开窗口在获得焦点或可见性变化时刷新，没有实时推送。

## 兼容性

- DSH `>=0.2.2-rc.1 <0.2.3-0`，Web profile（存在 `webServer` 服务）。
- 非 Web 界面仍可使用宿主工具，但星级界面需要 Web UI。

## 开发

```bash
node --check client.js
node test/host.test.mjs
```

宿主测试覆盖评级存储、JSON 路由（含参数校验和跨源拦截）、智能体工具，以及重新挂载后的持久化。

## 许可证

MIT

# dsh-session-stars

[English](README.md) | 中文

给 DeepSeek Harness Web UI 工作区里的会话加上 1-5 星收藏，并用等级区分重要程度。

有评级的会话行会显示一颗小星，颜色就是重要度等级；行尾 `...` 菜单里的“**重要度…**”打开 1-5 星选择器。安装 **会话快捷栏** 插件后，行右侧操作条由快捷栏接管，它的内置星标按钮负责 0/1 快速切换，1-5 级仍从菜单进入。评级保存在宿主的 JSON 文件里，刷新页面、重启应用或 Web 服务端口变化都不会丢。

## 功能

- **1-5 星重要度**：1 星最低，5 星最关键。行尾 `...` 菜单里的“**重要度…**”打开选择器；行右侧操作条由 **会话快捷栏** 插件接管，它的内置星标按钮负责 0/1 快速切换，精确等级从菜单设置。
- **区分明显、占用极小**：有评级的行只显示一颗实心小星，颜色就是等级（灰、绿、蓝、琥珀、红），列表不会被撑宽；会话悬浮卡片保留完整五星标尺和带等级名称的彩色标签。
- **选择器里有一把“重要度尺”**：五颗大星 + 五级刻度条（低 · 一般 · 重要 · 很重要 · 关键），当前等级高亮，支持数字键 1-5，保存后短暂显示“已保存”。
- **多窗口实时同步**：`/session-stars/events` 用 Server-Sent Events 推送每次提交后的评级，所有打开的 Web UI 窗口立即更新；窗口获得焦点时仍会兜底刷新。
- **宿主持久化**：评级保存在 `~/.dsh/session-stars.json`（或 `$DSH_HOME/session-stars.json`），写入串行并原子发布。
- **智能体工具**：`session_stars` 让模型读取评级、设置星级或清除评级，与界面共用同一份数据。
- **中英双语**：简体中文和英文文案，其他语言回退英文。
- **主题原生**：选择器和徽标只使用 `--dsw-alias-*` 主题变量，亮色/暗色主题都能正常显示。

## 安装

### 从 GitHub 安装

```sh
dsh plugin --profile desktop add github:879745uhjun/dsh-session-stars
```

装好后刷新 Web 页面。

### 从本地目录安装

本包是一个 DSH bundle（`dsh.bundle.patch`），通过插件管理器安装目录：

1. 让 DSH 智能体用 `plugin_manager` 的 `install_bundle` 安装本目录的绝对路径；
2. bundle 会以链接方式进入当前 profile 并即时生效；如果浏览器端没有马上出现，刷新 Web UI 页面即可。

宿主侧插入的行 id 是 `dsh-session-stars`，浏览器端由 `package.json` 的 `dsh.client` 声明。

## 使用

| 位置 | 行为 |
|---|---|
| 会话行 `...` 菜单 | **重要度…** 打开重要度选择器。 |
| 会话快捷栏（可选） | 快捷栏内置星标按钮负责 0/1 快速切换；精确的 1-5 级从菜单设置。 |
| 选择器 | 五颗大星 + 五级刻度；选 1-5、按数字键 1-5，或清除评级；`Esc` 或点击外部关闭。 |
| 会话行尾部徽标 | 一颗按等级着色的小星；标题/`aria-label` 里带 `N/5` 和等级名称。 |
| 会话悬浮卡片 | 五星标尺 + 带等级名称的彩色标签。 |
| 智能体工具 `session_stars` | `list` 读取、`set` 设置 1-5 星、`clear` 清除；省略 `sessionId` 时作用于当前会话。 |

等级：1 低、2 一般、3 重要、4 很重要、5 关键。

## 自检

打开 **设置 → 插件 → dsh-session-stars**，详情页会出现「自检」区块。只有点击「运行自检」才会执行，挂载时不会自动发请求。检查项：

1. `GET /session-stars` 返回 200，且 `ratings` 是对象；
2. `/session-stars/events` 能建立 SSE 连接（环境不支持或连不上时标记为「跳过」）；
3. `/session-stars/health` 报告 `session_stars` 工具已注册。

每项 2 秒超时；单项失败只显示原因，不影响其它项。「复制结果」会把上一次运行生成 Markdown 清单。

健康检查是只读接口：

```json
GET /session-stars/health
{ "ok": true, "tool": "session_stars", "registered": true }
```

## 数据与接口

- 文件：`<DSH home>/session-stars.json`，格式 `{ "version": 1, "updatedAt": <ms>, "ratings": { "<sessionId>": { "stars": 1-5, "updatedAt": <ms> } } }`。
- 浏览器路由：`GET /session-stars` 读取全部评级，`POST /session-stars` 携带 `{ "sessionId": "...", "stars": 0-5 }` 写入一条。`GET /session-stars/events` 是 Server-Sent Events 流（`event: ratings`），每次提交后推送完整快照。路由只接受同源请求，跨站 `Origin` 会被拒绝。
- 评级按会话 id 记录；删除会话不会自动删除评级，可在选择器里手动清除。
- 所有打开的窗口都会通过事件流收到每次提交；流断开时仍会在窗口获得焦点或可见性变化时兜底刷新。

## 兼容性

- DSH `>=0.2.2-rc.1 <0.2.3-0`，Web profile（存在 `webServer` 服务）。
- 非 Web 界面仍可使用宿主工具，但星级界面需要 Web UI。

## 开发

```bash
npm test
```

`pretest` 先用 `node --check` 检查两半源码；测试覆盖 Host 侧路由/事件流/健康检查/工具，以及客户端自检（注册元数据、成功路径、单项失败隔离、超时、Markdown 形状）。

## 许可证

MIT

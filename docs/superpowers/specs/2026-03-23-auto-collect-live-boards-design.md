# 自动采集直播大屏功能 设计文档

## 背景与目标

用户管理多个千川广告账号（aavid），每次需要手动逐个进入账号 → 找投放中计划 → 点击直播大屏 → 保存到聚合看板，操作繁琐。

**目标**：用户在 ECP 多账号管理页面，点击插件中一个按钮，自动发现所有正在直播的大屏并聚合到看板，全程无需手工干预。

---

## 关键 URL 结构

| 页面 | URL 模式 |
|------|----------|
| ECP 多账号管理页 | `business.oceanengine.com/site/account-manage/ecp/...` |
| 千川计划列表页 | `qianchuan.jinritemai.com/uni-prom?aavid={aavid}` |
| 千川计划详情页 | `qianchuan.jinritemai.com/uni-prom/detail?aavid={aavid}&adId={adId}` |
| 直播大屏页 | `qianchuan.jinritemai.com/board-next?live_room_id={live_room_id}&aavid={aavid}` |

**判断"正在直播"的依据**：计划详情或列表页出现"投放中"状态文字。
**大屏 URL 获取方式**：计划详情页上"直播大屏"红色按钮的 href，包含 `live_room_id`。

---

## 完整自动化流程

```
用户点击 Popup "🚀 自动采集所有直播大屏"
         │
         ▼
[background] 向 ECP 页面 content script 发送 scanAccounts 指令
         │
         ▼
[ecp content] 扫描 ECP 页面 DOM，提取所有千川账号 aavid 列表
         │  返回 [aavid1, aavid2, ...]
         ▼
[background] 串行处理每个 aavid：
  ├─ 打开新 Tab → /uni-prom?aavid=XXX（静默，不激活）
  ├─ 等待页面加载完成（MutationObserver 或 onUpdated 事件）
  ├─ 向该 Tab 的 content script 发送 scanLiveCampaigns 指令
  ├─ [content] 扫描页面找"投放中"计划行，提取每行的 adId
  ├─ 关闭该 Tab
  │
  ├─ 串行处理每个 adId：
  │    ├─ 打开新 Tab → /uni-prom/detail?aavid=XXX&adId=YYY（静默）
  │    ├─ 等待页面加载
  │    ├─ 向该 Tab 的 content script 发送 extractBoardUrl 指令
  │    ├─ [content] 找"直播大屏"按钮，提取 href 中的 live_room_id
  │    ├─ 构造 board URL，发送 saveBoardUrl 存储（去重）
  │    └─ 关闭该 Tab
  │
  └─ 更新 popup 进度（正在检查 N/M 个账号...）
         │
         ▼
[background] 所有账号处理完毕
         │
         ▼
打开聚合看板（dashboard.html）
```

---

## 各组件改动说明

### manifest.json
- `host_permissions` 新增 `https://business.oceanengine.com/*`
- `content_scripts` 新增匹配规则覆盖 `business.oceanengine.com`（可复用 content.js 或新建 ecp_content.js）

### background.js 新增消息处理器

**`autoCollectBoards`**
- 接收来自 popup 的触发指令
- 获取 ECP 页面当前 Tab，发送 `scanAccounts` 指令
- 串行处理 aavid 列表，管理临时 Tab 的生命周期
- 每步完成后通过 `chrome.runtime.sendMessage` 推送进度到 popup
- 全部完成后打开 `dashboard.html`

**Tab 等待策略**：监听 `chrome.tabs.onUpdated` 事件，等 `status === 'complete'` 后再发消息给 content script，再加 1-2 秒延时等待 SPA 渲染。

### content.js 新增消息处理器

**`scanAccounts`**（在 ECP 页面执行）
- 扫描 DOM 中包含千川账号 ID 的元素
- 提取所有 `aavid`（数字 ID），去重后返回数组

**`scanLiveCampaigns`**（在 `/uni-prom` 计划列表页执行）
- 扫描页面中状态为"投放中"的计划行
- 提取每行的 `adId`（从行内链接 href 或 data 属性获取）
- 返回 `adId` 数组

**`extractBoardUrl`**（在 `/uni-prom/detail` 详情页执行）
- 查找文字为"直播大屏"的按钮/链接
- 提取其 href，解析出 `live_room_id` 参数
- 构造并返回完整的 `board-next` URL

### popup.js 新增逻辑

- 检测当前 Tab 是否在 `business.oceanengine.com`，是则显示"🚀 自动采集所有直播大屏"按钮
- 按钮点击后进入 loading 状态，展示进度文字
- 监听来自 background 的进度消息，实时更新显示
- 完成后显示结果摘要（找到 N 个直播大屏）

---

## 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| ECP 页面找不到任何 aavid | 提示用户"未找到千川账号，请确认当前页面" |
| 某个账号没有投放中的计划 | 静默跳过，继续下一个账号 |
| 详情页找不到"直播大屏"按钮 | 静默跳过该计划 |
| 大屏 URL 已存在（重复） | 去重，不重复添加（已有逻辑） |
| Tab 加载超时（>15秒） | 跳过该 Tab，记录错误，继续 |
| 用户在采集中途关闭 popup | background 继续执行，完成后自动打开看板 |

---

## 不在本次范围内

- 定时自动采集（Cron）
- 多账号并行处理（当前串行，避免对千川服务器压力过大）
- 跨浏览器支持（仅 Chrome/Chromium）

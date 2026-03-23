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

**判断"正在直播"的依据**：计划详情页或列表页出现"投放中"文字的状态元素。
**大屏 URL 获取方式**：计划详情页"直播大屏"红色 `<a>` 标签的 `href` 属性（包含 `live_room_id`），直接读取 href 属性，无需点击。

---

## 完整自动化流程

```
用户点击 Popup "🚀 自动采集所有直播大屏"
         │
         ▼
[popup] 将当前 Tab ID 写入消息，发送 autoCollectBoards 给 background
        同时禁用按钮（防止重复点击），开始每秒轮询 collectProgress
         │
         ▼
[background] 向指定 ECP Tab 发送 scanAccounts 指令
             若返回 aavid 为空，写入 collectProgress = { status: 'error', error: '未找到千川账号' }，退出
         │
         ▼
[background] 写入初始进度到 storage：
             collectProgress = { status: 'running', total: N, current: 0, found: 0, skippedAccounts: 0 }
             串行处理每个 aavid：
  ├─ 在 chrome.tabs.create 之前注册 onUpdated 监听器（按 tabId 过滤）
  ├─ 打开新 Tab → /uni-prom?aavid=XXX（active: false）
  ├─ 等待该 Tab status==='complete'（监听器收到后移除自身），再 setTimeout(2000)
  │   若 15 秒内未收到 complete，超时处理：移除监听器
  ├─ try { 发送 scanLiveCampaigns } finally { 关闭该 Tab }
  ├─ 若返回 adIds 为空，skippedAccounts+1，继续下一个 aavid
  │
  ├─ 串行处理每个 adId：
  │    ├─ 在 create 之前注册 onUpdated 监听器（按 tabId 过滤）
  │    ├─ 打开新 Tab → /uni-prom/detail?aavid=XXX&adId=YYY（active: false）
  │    ├─ 等待 status==='complete' + 2秒（监听器收到后移除自身）
  │    │   若 15 秒超时，移除监听器
  │    ├─ try { 发送 extractBoardUrl } finally { 关闭该 Tab }
  │    └─ 若返回 url 非空，调用 saveBoardInternal(url, title)
  │
  └─ 更新 collectProgress.current++
         │
         ▼
[background] 全部完成：
             collectProgress = { status: 'done', total: N, found: M, skippedAccounts: K }
             chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })
```

---

## 各组件改动说明

### manifest.json

- `host_permissions` 数组中新增 `"https://business.oceanengine.com/*"`
- `content_scripts` **现有唯一条目**的 `matches` 数组中追加 `"https://business.oceanengine.com/*"`（复用同一个 content.js 文件，不新增第二个 content_scripts 条目，否则 content.js 会在 qianchuan 页面被注入两次）
- 这两处修改必须同时完成：`host_permissions` 缺失会导致 `chrome.tabs.sendMessage` 无法到达 ECP Tab；`content_scripts.matches` 缺失会导致 ECP 页面无 content script 可接收消息
- `rules.json` **不需要修改**：ECP 页面只被脚本扫描，不做 iframe 嵌入
- 现有 `"scripting"` 权限已足够向非活动 Tab 发消息

### background.js 改动

**新增 `saveBoardInternal(url, title)` 函数**（替代直接调用 `handleSaveBoardUrl`）
- `handleSaveBoardUrl` 原本依赖 `sendResponse` 回调，内部调用会崩溃
- 新增一个返回 Promise 的内部函数，包含与 `handleSaveBoardUrl` 相同的去重+保存逻辑
- `handleSaveBoardUrl` 消息处理器改为调用 `saveBoardInternal`，再把结果传给 `sendResponse`

```javascript
// 新函数签名：
async function saveBoardInternal(url, title) → Promise<{ success, count?, error? }>
```

**新增 `autoCollectBoards` 消息处理器**
- 在现有 `switch (action)` 中新增 `case 'autoCollectBoards':` 并 `return true`（异步响应）
- 入参：`{ tabId }` — popup 传入的当前 ECP Tab ID
- Tab 等待工具函数：`waitForTabComplete(tabId, timeoutMs=15000)` → Promise，在 `chrome.tabs.create` 之前注册监听，收到 complete 或超时后自动移除监听器，避免泄漏
- 所有 Tab 操作用 `try/finally` 包裹，finally 中调用 `chrome.tabs.remove(tabId)` 确保 Tab 必被关闭
- 打开看板用 `chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })`

### content.js 改动

**在现有 `switch (action)` 中新增三个 case**（不新建文件）：

**`scanAccounts` case**（在 ECP 页面执行）
- 主策略：`document.querySelectorAll('a[href]')` 遍历，用正则 `/[?&]aavid=(\d+)/` 提取每个链接的 aavid
- 仅此策略，去除"扫描16-19位数字文本节点"兜底（范围过宽，会误匹配订单号等）
- 若主策略无结果则返回空数组，由 background 报错给用户
- 返回：`{ aavids: ['123...', '456...'] }`

**`scanLiveCampaigns` case**（在 `/uni-prom` 计划列表页执行）
- 策略一：找所有文字含"投放中"的元素，向上遍历到最近的行容器，从该行所有链接 href 中正则提取 `adId=(\d+)`
- 策略二（兜底）：找页面所有 href 含 `adId=` 的链接，过滤其父级容器内是否有"投放中"文字
- 若页面无"投放中"文字（未登录跳转登录页），自然返回 `{ adIds: [] }`
- 返回：`{ adIds: ['111...', '222...'] }`

**`extractBoardUrl` case**（在 `/uni-prom/detail` 详情页执行）
- 策略一：`document.querySelectorAll('a')` 遍历，找 `textContent` 含"直播大屏"的 `<a>` 标签，读其 `href`
- 策略二（兜底）：找所有 `href` 含 `board-next` 的 `<a>` 标签
- 验证 href 包含 `live_room_id=` 参数后返回
- 返回：`{ url: 'https://...' }` 或 `{ url: null }`

**ECP 页面上的 `init()` 行为**：
- `isBoardPage()` 在 ECP 页面返回 false → 浮动按钮不显示（安全）
- `MutationObserver` 会在 ECP 页面启动，观察 DOM 变化（无害，因为 URL 变化检测只在 board-next 页才触发操作）

### popup.js 改动

**按钮显示条件**：检测当前 Tab URL 是否包含 `business.oceanengine.com`，是则渲染"🚀 自动采集所有直播大屏"按钮。

**点击处理**：
1. 立即禁用按钮（`button.disabled = true`），防止重复点击
2. 发送 `autoCollectBoards` 消息，传入当前 tabId
3. 启动轮询：`intervalId = setInterval(pollProgress, 1000)`

**轮询 `pollProgress()`**：
- 读取 `chrome.storage.local.get('collectProgress')`
- `status === 'running'`：显示 `⏳ 正在检查 {current}/{total} 个账号，已找到 {found} 个大屏...`
- `status === 'done'`：显示 `✅ 完成！找到 {found} 个直播大屏（跳过 {skippedAccounts} 个账号）`，调用 `clearInterval(intervalId)`，恢复按钮
- `status === 'error'`：显示错误信息，调用 `clearInterval(intervalId)`，恢复按钮
- `collectProgress` 为 undefined（首次打开）：不显示进度，按钮正常可用

---

## 进度数据结构

```javascript
// 运行中（写入时同步记录时间戳）
collectProgress = {
  status: 'running',
  startedAt: Date.now(),  // 用于检测过期状态
  total: 8,               // 总账号数
  current: 3,             // 已处理账号数
  found: 2,               // 已找到并保存的大屏数
  skippedAccounts: 1      // 跳过的账号数（无投放中/超时/未登录）
}

// 完成
collectProgress = {
  status: 'done',
  total: 8,
  found: 5,
  skippedAccounts: 3
}

// 错误（在 running 开始前失败）
collectProgress = {
  status: 'error',
  error: '未找到千川账号，请确认当前页面'
}
```

**过期 running 状态处理**：popup 的 `pollProgress` 在读到 `status === 'running'` 时，检查 `Date.now() - startedAt > 5 * 60 * 1000`（5分钟）。若超期，视为 background service worker 已被 Chrome 终止，将 `collectProgress` 重置为 `{ status: 'idle' }`，恢复按钮可用状态并显示提示"上次采集已中断，请重新点击"。

---

## 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| ECP 页面未找到任何 aavid | 写入 error 状态到 storage，popup 显示错误，不打开看板 |
| 账号未登录/跳转登录页 | `scanLiveCampaigns` 返回空数组，skippedAccounts+1，继续 |
| 该账号没有投放中的计划 | 同上 |
| 详情页找不到"直播大屏"链接 | 静默跳过该计划（不计入 skippedAccounts，属于计划级，非账号级） |
| 大屏 URL 已存在（重复） | `saveBoardInternal` 内部去重，不重复添加 |
| Tab 加载超时（>15秒） | 移除 onUpdated 监听器，finally 关闭 Tab，skippedAccounts+1 |
| Tab 操作抛出异常 | try/finally 确保 Tab 关闭，异常 console.error，继续下一个 |
| 用户中途关闭 popup | background 继续执行；popup 重新打开后从 storage 读当前进度 |
| 用户重复点击按钮 | 按钮在运行期间处于 disabled 状态，无法触发第二次 |

---

## 不在本次范围内

- 定时自动采集（Cron）
- 多账号并行处理（串行，避免对千川服务器施压过大）
- 跨浏览器支持（仅 Chrome/Chromium）
- 自动刷新已有看板列表（本次只追加新发现的大屏）

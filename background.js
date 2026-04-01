/**
 * 千川多账号直播聚合看板 - Background Service Worker
 * 
 * 功能：
 * 1. 插件安装时初始化存储
 * 2. 处理来自 popup/content 的消息请求
 * 3. 管理看板数据（boards）的增删改查
 */

// ============================================
// 工具函数
// ============================================

/**
 * #13: 等待采集恢复（用事件驱动替代 while(true) 轮询）
 * 监听 storage.onChanged，collectPaused 变为 false 时 resolve
 */
function waitForResume() {
  return new Promise(resolve => {
    const listener = (changes) => {
      if ('collectPaused' in changes && !changes.collectPaused.newValue) {
        chrome.storage.onChanged.removeListener(listener);
        resolve();
      }
    };
    chrome.storage.onChanged.addListener(listener);
  });
}

// ============================================
// 安装/更新初始化
// ============================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装时初始化存储
    chrome.storage.local.set({ boards: [] }, () => {
      if (chrome.runtime.lastError) { console.error('[千川看板] 初始化存储失败:', chrome.runtime.lastError); return; }
      console.log('[千川看板] 初始化存储完成');
    });
  }
});

// ============================================
// 消息处理器
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, data } = message;

  switch (action) {
    case 'saveBoardUrl':
      // 保存看板链接
      handleSaveBoardUrl(data, sendResponse);
      return true; // 异步响应

    case 'getBoards':
      // 获取所有看板
      handleGetBoards(sendResponse);
      return true; // 异步响应

    case 'deleteBoard':
      // 删除指定看板
      handleDeleteBoard(data, sendResponse);
      return true; // 异步响应

    case 'clearAll':
      // 清空所有看板
      handleClearAll(sendResponse);
      return true; // 异步响应

    case 'autoNavigate':
      // 触发自动导航
      handleAutoNavigate(sendResponse);
      return true; // 异步响应

    case 'saveBoards':
      // 保存看板列表（用于排序）
      handleSaveBoards(data, sendResponse);
      return true; // 异步响应

    case 'autoCollectBoards':
      // 自动采集所有直播大屏
      handleAutoCollectBoards(data, sendResponse);
      return true; // 异步响应

    case 'captureTabAudio':
      // 捕获当前标签页音频流 ID
      chrome.tabCapture.getMediaStreamId(
        { consumerTabId: sender.tab.id },
        (streamId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, streamId });
          }
        }
      );
      return true; // 异步响应

    case 'openTab':
      // 打开新标签页并返回 tabId（active 默认 false，后台静默打开）
      chrome.tabs.create({ url: data.url, active: false }, (tab) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, tabId: tab.id });
        }
      });
      return true;

    case 'getDashboardTabId':
      // 返回发送者的 tabId（即 dashboard 自身）
      sendResponse({ success: true, tabId: sender.tab.id });
      return false;

    case 'moveTabToMiniWindow':
      // 把指定 tab 移到独立最小化小窗，避免占用主窗口标签栏
      chrome.windows.create({
        tabId: data.tabId,
        type: 'popup',
        width: 400,
        height: 300,
        state: 'minimized'
      }, (win) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, windowId: win.id });
        }
      });
      return true;

    case 'collectGmvData':
      // 从 dashboard 的所有 board-next iframe 中收集 GMV 数据
      handleCollectGmvData(sender.tab.id, sendResponse);
      return true;

    case 'captureDouyinTab':
      // 捕获指定 tab 的音视频流，供 dashboard 消费
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: data.targetTabId, consumerTabId: data.consumerTabId },
        (streamId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, streamId });
          }
        }
      );
      return true;

    default:
      sendResponse({ success: false, error: '未知 action: ' + action });
      return false;
  }
});

// ============================================
// Handler 函数
// ============================================

/**
 * 保存看板链接（内部 Promise 版本，供 autoCollectBoards 直接调用）
 * @param {string} url
 * @param {string} [title]
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
function saveBoardInternal(url, title) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({ success: false, error: '缺少 URL 参数' });
      return;
    }

    chrome.storage.local.get(['boards'], (result) => {
      const boards = result.boards || [];

      const isDuplicate = boards.some(board => board.url === url);
      if (isDuplicate) {
        resolve({ success: false, error: '该链接已存在', count: boards.length });
        return;
      }

      const newBoard = {
        id: Date.now(),
        url,
        title: title || '未命名看板',
        timestamp: new Date().toISOString()
      };

      boards.push(newBoard);
      chrome.storage.local.set({ boards }, () => {
        if (chrome.runtime.lastError) { resolve({ success: false, error: chrome.runtime.lastError.message }); return; }
        resolve({ success: true, count: boards.length, board: newBoard });
      });
    });
  });
}

/**
 * 保存看板链接（消息处理器版本）
 * @param {Object} data - { url: string, title: string }
 * @param {Function} sendResponse - 响应回调
 */
function handleSaveBoardUrl(data, sendResponse) {
  saveBoardInternal(data && data.url, data && data.title)
    .then(sendResponse);
}

/**
 * 获取所有看板
 * @param {Function} sendResponse - 响应回调
 */
function handleGetBoards(sendResponse) {
  chrome.storage.local.get(['boards'], (result) => {
    const boards = result.boards || [];
    sendResponse({ success: true, boards });
  });
}

/**
 * 删除指定看板
 * @param {Object} data - { id: number }
 * @param {Function} sendResponse - 响应回调
 */
function handleDeleteBoard(data, sendResponse) {
  if (!data || !data.id) {
    sendResponse({ success: false, error: '缺少 id 参数' });
    return;
  }

  chrome.storage.local.get(['boards'], (result) => {
    let boards = result.boards || [];
    const initialCount = boards.length;

    // 过滤掉指定 id 的看板
    boards = boards.filter(board => board.id !== data.id);

    if (boards.length === initialCount) {
      sendResponse({ success: false, error: '未找到指定看板' });
      return;
    }

    chrome.storage.local.set({ boards }, () => {
      if (chrome.runtime.lastError) { sendResponse({ success: false, error: chrome.runtime.lastError.message }); return; }
      sendResponse({ success: true, count: boards.length });
    });
  });
}

/**
 * 清空所有看板
 * @param {Function} sendResponse - 响应回调
 */
function handleClearAll(sendResponse) {
  chrome.storage.local.set({ boards: [] }, () => {
    if (chrome.runtime.lastError) { sendResponse({ success: false, error: chrome.runtime.lastError.message }); return; }
    sendResponse({ success: true, count: 0 });
  });
}

/**
 * 触发自动导航
 * 向当前活动标签页发送导航指令
 * @param {Function} sendResponse - 响应回调
 */
async function handleAutoNavigate(sendResponse) {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      sendResponse({ success: false, error: '未找到活动标签页' });
      return;
    }

    // 检查是否在千川域名下
    const qianchuanUrls = ['qianchuan.jinritemai.com', 'buyin.jinritemai.com'];
    const isQianchuanPage = qianchuanUrls.some(url => tab.url && tab.url.includes(url));

    if (!isQianchuanPage) {
      sendResponse({ success: false, error: '当前页面不是千川页面' });
      return;
    }

    // #6 修复：等待 content script 确认收到指令再返回
    const reply = await chrome.tabs.sendMessage(tab.id, { action: 'startNavigation' })
      .catch(e => ({ success: false, error: e.message }));
    if (reply && reply.success) {
      sendResponse({ success: true, message: '导航指令已发送并确认' });
    } else {
      sendResponse({ success: false, error: (reply && reply.error) || 'content script 未响应，请确认页面已加载' });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 保存看板列表（用于排序）
 * @param {Object} data - { boards: array }
 * @param {Function} sendResponse - 响应回调
 */
function handleSaveBoards(data, sendResponse) {
  if (!data || !Array.isArray(data.boards)) {
    sendResponse({ success: false, error: '缺少 boards 参数' });
    return;
  }

  chrome.storage.local.set({ boards: data.boards }, () => {
    if (chrome.runtime.lastError) { sendResponse({ success: false, error: chrome.runtime.lastError.message }); return; }
    sendResponse({ success: true, count: data.boards.length });
  });
}

// ============================================
// 自动采集直播大屏
// ============================================

/**
 * 等待新 Tab 被创建，返回 tab 对象；超时则返回 null
 * 注意：必须在触发点击之前调用，以避免监听器注册竞态
 * @param {number} [timeoutMs=8000]
 * @param {number|null} [openerTabId=null] - #14: 仅接受由该 tab 打开的新 tab，过滤无关 tab
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
function waitForNewTab(timeoutMs = 8000, openerTabId = null) {
  return new Promise((resolve) => {
    let timer;
    function listener(tab) {
      // #14: 如果指定了 openerTabId，忽略非该 tab 打开的新 tab
      if (openerTabId !== null && tab.openerTabId !== openerTabId) return;
      chrome.tabs.onCreated.removeListener(listener);
      clearTimeout(timer);
      resolve(tab);
    }
    chrome.tabs.onCreated.addListener(listener);
    timer = setTimeout(() => {
      chrome.tabs.onCreated.removeListener(listener);
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * 等待指定 Tab 的 URL 匹配正则且 status=complete
 * @param {number} tabId
 * @param {RegExp} regex
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<chrome.tabs.Tab|null>} 匹配到的 tab 对象，超时返回 null
 */
function waitForTabUrlMatch(tabId, regex, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let timer;
    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete' && regex.test(tab.url)) {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve(tab);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * 安全关闭 Tab（忽略已关闭/不存在的情况）
 * @param {number|null} tabId
 */
async function safeClose(tabId) {
  if (tabId == null) return;
  try { await chrome.tabs.remove(tabId); } catch (e) { /* 已关闭或不存在 */ }
}

/**
 * 向指定 Tab 发送消息，带超时保护
 * @param {number} tabId
 * @param {Object} message
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<any>}
 */
function sendMessageToTab(tabId, message, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * 向 collectProgress.logs 追加一条日志并写入 storage
 * @param {string[]} logs - 当前日志数组（in-place 追加）
 * @param {string} text
 * @param {'info'|'success'|'skip'|'error'} type
 */
async function logCollect(logs, text, type = 'info') {
  console.log(`[千川看板] ${text}`);
  logs.push({ text, type, ts: Date.now() });
  const { collectProgress } = await chrome.storage.local.get('collectProgress');
  await chrome.storage.local.set({
    collectProgress: { ...collectProgress, logs: logs.slice(-200) }
  });
}

/**
 * 自动采集所有直播大屏（模拟人工操作流程）
 * 流程：ECP账号列表(A) → 点击账号 → 计划列表页(B) → 点击投放中计划 → 计划详情页(C) → 点击直播大屏 → 大屏页(D) → 保存URL
 * @param {Object} data - { tabId: number } ECP 页面的 Tab ID
 * @param {Function} sendResponse
 */
async function handleAutoCollectBoards(data, sendResponse) {
  const ecpTabId = data && data.tabId;
  if (!ecpTabId) {
    sendResponse({ success: false, error: '缺少 tabId 参数' });
    return;
  }

  sendResponse({ success: true, message: '采集已启动' });

  let found = 0;        // 新增保存的大屏数
  let foundDup = 0;    // 已存在的大屏数
  let skippedAccounts = 0;
  let hasMore = true;
  const logs = [];

  await chrome.storage.local.set({
    collectProgress: { status: 'running', startedAt: Date.now(), found: 0, foundDup: 0, skippedAccounts: 0, logs }
  });

  try {
    while (hasMore) {
      const countResult = await sendMessageToTab(ecpTabId, { action: 'getAccountCount' });
      const N = (countResult && countResult.count) || 0;

      if (N === 0) {
        await logCollect(logs, '❌ ECP 页面未找到账号，请确认已打开账号列表页', 'error');
        break;
      }

      await logCollect(logs, `📋 共检测到 ${N} 个账号，逐个检查直到无投放中计划为止`);

      for (let i = 0; i < N; i++) {
        // #13: 暂停检测：用事件驱动等待"继续采集"，避免 while(true) 轮询
        const { collectPaused } = await chrome.storage.local.get('collectPaused');
        if (collectPaused) await waitForResume();

        let qcTabId = null;
        let boardTabId = null;

        try {
          await logCollect(logs, `─── 第 ${i + 1}/${N} 个账号 ───`);

          // A→B：尝试获取 URL 静默打开；否则监听新标签
          const newTabPromise = waitForNewTab(8000, ecpTabId);
          const accountResult = await sendMessageToTab(ecpTabId, { action: 'clickAccount', index: i });

          let qcTab;
          if (accountResult && accountResult.url) {
            // 静默打开，不切换到该标签
            qcTab = await chrome.tabs.create({ url: accountResult.url, active: false });
          } else {
            qcTab = await newTabPromise;
            if (!qcTab) {
              await logCollect(logs, '⏭️ 点击账号后未打开新标签，跳过', 'skip');
              skippedAccounts++;
              continue;
            }
          }
          qcTabId = qcTab.id;
          await logCollect(logs, '✓ 已打开千川计划列表页', 'success');

          // 等待页面B加载
          const qcLoaded = await waitForTabUrlMatch(qcTabId, /uni-prom/, 15000);
          if (!qcLoaded) {
            await logCollect(logs, '⏭️ 计划列表页加载超时，跳过', 'skip');
            skippedAccounts++;
            continue;
          }

          // 步骤1：轮询等待"直播大屏"徽标出现（最多等 15s）
          let checkResult = null;
          for (let retry = 0; retry < 6; retry++) {
            await new Promise(r => setTimeout(r, retry === 0 ? 3000 : 2000));
            checkResult = await sendMessageToTab(qcTabId, { action: 'checkLiveCampaign' });
            if (checkResult && checkResult.badgeCount > 0) break;
            if (retry > 0) await logCollect(logs, `  ↩ 等待页面渲染(${retry})... badge=${checkResult?.badgeCount ?? '?'}`);
          }

          if (!checkResult || checkResult.badgeCount === 0) {
            if (checkResult && checkResult.statusCount === 0) {
              // 该账号无任何"投放中"计划，继续检查下一个
              await logCollect(logs, `⏭️ 账号 ${i + 1} 无投放中计划，继续检查下一个`, 'skip');
              skippedAccounts++;
              continue;
            }
            const textsStr = checkResult?.statusTexts?.join(',') || '无';
            await logCollect(logs, `⏭️ 有计划但无直播大屏（status=${checkResult?.statusCount} anyBadge=${checkResult?.anyBadgeCount ?? '?'} 状态词:[${textsStr}]），跳过`, 'skip');
            skippedAccounts++;
            continue;
          }

          await logCollect(logs, `✓ 找到"直播大屏"徽标，尝试获取链接`);

          // 步骤2：先注册监听，再触发点击（防竞态）
          const boardTabPromise = waitForNewTab(10000);
          const clickResult = await sendMessageToTab(qcTabId, { action: 'clickLiveCampaign' });

          let boardUrl = null;

          if (clickResult && clickResult.url) {
            // content 直接返回了 URL（没有调用 click），直接打开
            await logCollect(logs, `✓ 获取到直播大屏链接，直接打开`);
            const newTab = await chrome.tabs.create({ url: clickResult.url, active: false });
            boardTabId = newTab.id;
            boardUrl = clickResult.url;
          } else {
            // content 调用了 badge.click()，等待新标签
            const boardTab = await boardTabPromise;
            if (!boardTab) {
              await logCollect(logs, '⏭️ 点击后未打开新标签，跳过', 'skip');
              skippedAccounts++;
              continue;
            }
            boardTabId = boardTab.id;
            // 立即推到后台，避免页面闪烁
            await chrome.tabs.update(boardTabId, { active: false }).catch(() => {});
            // 等待 tab 加载完成（最多 12s）
            const boardLoaded = await waitForTabUrlMatch(boardTabId, /.*/, 12000);
            const tabInfo = boardLoaded ? boardLoaded : await chrome.tabs.get(boardTabId).catch(() => null);
            const tabUrl = tabInfo && tabInfo.url;
            await logCollect(logs, `ℹ️ 新标签 URL: ${(tabUrl || '未知').substring(0, 80)}`);
            if (!tabUrl || !tabUrl.includes('board-next')) {
              await logCollect(logs, '⏭️ 新标签不是直播大屏页面，跳过', 'skip');
              skippedAccounts++;
              continue;
            }
            boardUrl = tabUrl;
          }
          if (boardUrl && boardUrl.includes('board-next')) {
            const saveResult = await saveBoardInternal(boardUrl, '直播大屏');
            if (saveResult.success) {
              found++;
              await logCollect(logs, `✅ 新增保存！已采集 ${found} 个大屏`, 'success');
            } else if (saveResult.error && saveResult.error.includes('已存在')) {
              foundDup++;
              await logCollect(logs, `ℹ️ 已存在，跳过（共发现 ${found + foundDup} 个）`, 'skip');
            } else {
              await logCollect(logs, `⚠️ ${saveResult.error}`, 'skip');
            }
          }

        } catch (e) {
          await logCollect(logs, `❌ 出错：${e.message}`, 'error');
          skippedAccounts++;
        } finally {
          await safeClose(boardTabId);
          await safeClose(qcTabId);
        }
      }

      hasMore = false;
    }
  } catch (e) {
    // #5 修复：catch 时把 failed 状态写入 storage，调用方可通过轮询感知失败
    await logCollect(logs, `❌ 采集中断：${e.message}`, 'error');
    await chrome.storage.local.set({
      collectProgress: { status: 'failed', error: e.message, found, foundDup, skippedAccounts, logs }
    });
    return;
  }

  // 全部完成
  await chrome.storage.local.set({
    collectProgress: { status: 'done', found, foundDup, skippedAccounts, logs }
  });

  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}


/**
 * 收集 dashboard tab 中所有 board-next iframe 的 GMV 数据
 * @param {number} dashboardTabId - dashboard 所在 tab ID
 * @param {Function} sendResponse
 */
function handleCollectGmvData(dashboardTabId, sendResponse) {
  if (!dashboardTabId) {
    sendResponse({ success: false, error: '无效的 tabId' });
    return;
  }

  // 先用 getAllFrames 拿到 board-next frame 的 ID 列表
  // 再用 executeScript 精确注入这些 frame，避免尝试注入 extension 页面导致整体报错
  chrome.webNavigation.getAllFrames({ tabId: dashboardTabId }, (frames) => {
    if (chrome.runtime.lastError || !frames) {
      console.warn('[千川看板] getAllFrames 失败:', chrome.runtime.lastError);
      sendResponse({ success: true, data: [] });
      return;
    }

    const boardFrames = frames.filter(f => f.url && f.url.includes('board-next'));
    console.log('[千川看板] 找到 board-next frames:', boardFrames.length);

    if (boardFrames.length === 0) {
      sendResponse({ success: true, data: [] });
      return;
    }

    const frameIds = boardFrames.map(f => f.frameId);

    chrome.scripting.executeScript({
      target: { tabId: dashboardTabId, frameIds },
      func: function() {
        const txt = (document.body && document.body.innerText) || '';

        // ---- 直播间名：取"直播中"前一行或前几个字 ----
        let title = null;
        let m = txt.match(/([^\n\r]{2,40}?)\s*[\n\r]\s*直播中/);
        if (m && m[1]) title = m[1].trim();
        if (!title) {
          m = txt.match(/([^\n\r\t]{2,40}?)\s{1,4}直播中/);
          if (m && m[1]) title = m[1].trim();
        }
        if (title && /^\d[\d\s:/-]*$/.test(title)) title = null;
        if (!title) title = document.title || '直播大屏';

        // ---- 关键指标：innerText 正则匹配 ----
        const metrics = {};
        const NP = '([\\d,]+\\.?\\d*)';
        function ex(label) {
          const e = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // 优先：标签（可带括号后缀）→ 换行 → 数字
          // 例：净成交金额(元)\n743,932.14
          let r = txt.match(new RegExp(e + '[^\\d\\n]*\\n\\s*' + NP));
          if (r && r[1] !== '0') return r[1];
          // 次选：标签后直接跟空白再跟数字（同行，无括号后缀）
          r = txt.match(new RegExp(e + '[^\\S\\n]{0,4}' + NP));
          if (r && r[1] !== '0') return r[1];
          return null;
        }

        const v1 = ex('净成交金额');     if (v1) metrics.gmv    = v1;
        const v2 = ex('整体消耗');       if (v2) metrics.spend  = v2;
        const v3 = ex('净成交ROI');      if (v3) metrics.roi    = v3;
        const v4 = ex('整体成交订单数'); if (v4) metrics.orders = v4;
        const v5 = ex('GPM');            if (v5) metrics.gpm    = v5;
        const v6 = ex('实时在线人数');   if (v6) metrics.online = v6;

        return { url: location.href, title, metrics };
      }
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.warn('[千川看板] executeScript 失败:', chrome.runtime.lastError.message);
        sendResponse({ success: true, data: [] });
        return;
      }
      // #12: 记录注入失败的帧，方便调试
      const failedCount = (results || []).filter(r => !r || r.result === null || r.result === undefined).length;
      if (failedCount > 0) {
        console.warn('[千川看板] 有', failedCount, '个 frame 注入失败（可能未完全加载）');
      }
      const data = (results || [])
        .filter(r => r && r.result !== null && r.result !== undefined)
        .map(r => r.result);
      console.log('[千川看板] GMV 采集完成，共', data.length, '条');
      sendResponse({ success: true, data });
    });
  });
}


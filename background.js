/**
 * 千川多账号直播聚合看板 - Background Service Worker
 * 
 * 功能：
 * 1. 插件安装时初始化存储
 * 2. 处理来自 popup/content 的消息请求
 * 3. 管理看板数据（boards）的增删改查
 */

// ============================================
// 安装/更新初始化
// ============================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装时初始化存储
    chrome.storage.local.set({ boards: [] }, () => {
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

    // 向内容脚本发送导航指令
    await chrome.tabs.sendMessage(tab.id, { action: 'startNavigation' });
    sendResponse({ success: true, message: '导航指令已发送' });
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
    sendResponse({ success: true, count: data.boards.length });
  });
}

// ============================================
// 自动采集直播大屏
// ============================================

/**
 * 等待指定 Tab 加载完成
 * 必须在 chrome.tabs.create 之前调用，以避免监听器注册竞态
 * @param {number} tabId
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<boolean>} true=加载完成, false=超时
 */
function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let timer;

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve(true);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
  });
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
 * 自动采集所有直播大屏
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

  // 1. 扫描 ECP 页面获取所有 aavid
  const scanResult = await sendMessageToTab(ecpTabId, { action: 'scanAccounts' });
  const aavids = scanResult && scanResult.aavids;

  if (!aavids || aavids.length === 0) {
    await chrome.storage.local.set({
      collectProgress: { status: 'error', error: '未找到千川账号，请确认当前页面为 ECP 多账号管理页' }
    });
    return;
  }

  // 2. 初始化进度
  let found = 0;
  let skippedAccounts = 0;
  await chrome.storage.local.set({
    collectProgress: {
      status: 'running',
      startedAt: Date.now(),
      total: aavids.length,
      current: 0,
      found: 0,
      skippedAccounts: 0
    }
  });

  // 3. 串行处理每个 aavid
  for (let i = 0; i < aavids.length; i++) {
    const aavid = aavids[i];
    let listTabId = null;

    try {
      // 打开计划列表页（在注册监听器之后）
      const listUrl = `https://qianchuan.jinritemai.com/uni-prom?aavid=${aavid}`;
      const waitPromise = new Promise((resolve) => {
        let timer;
        function listener(updatedTabId, changeInfo) {
          if (changeInfo.status === 'complete') {
            // tabId 在 create 回调后才知道，通过闭包共享
            if (listTabId !== null && updatedTabId === listTabId) {
              chrome.tabs.onUpdated.removeListener(listener);
              clearTimeout(timer);
              resolve(true);
            }
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
        timer = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(false);
        }, 15000);
      });

      const listTab = await chrome.tabs.create({ url: listUrl, active: false });
      listTabId = listTab.id;

      const loaded = await waitPromise;
      if (!loaded) {
        skippedAccounts++;
        continue;
      }

      // 等待 SPA 渲染
      await new Promise(r => setTimeout(r, 2000));

      // 扫描投放中的计划
      const campaignResult = await sendMessageToTab(listTabId, { action: 'scanLiveCampaigns' });
      const adIds = campaignResult && campaignResult.adIds;

      if (!adIds || adIds.length === 0) {
        skippedAccounts++;
        continue;
      }

      // 4. 串行处理每个 adId
      for (const adId of adIds) {
        let detailTabId = null;
        try {
          const detailUrl = `https://qianchuan.jinritemai.com/uni-prom/detail?aavid=${aavid}&adId=${adId}&ct=1&dr=${new Date().toISOString().slice(0,10)},${new Date().toISOString().slice(0,10)}`;

          const detailWaitPromise = new Promise((resolve) => {
            let timer;
            function listener(updatedTabId, changeInfo) {
              if (changeInfo.status === 'complete') {
                if (detailTabId !== null && updatedTabId === detailTabId) {
                  chrome.tabs.onUpdated.removeListener(listener);
                  clearTimeout(timer);
                  resolve(true);
                }
              }
            }
            chrome.tabs.onUpdated.addListener(listener);
            timer = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve(false);
            }, 15000);
          });

          const detailTab = await chrome.tabs.create({ url: detailUrl, active: false });
          detailTabId = detailTab.id;

          const detailLoaded = await detailWaitPromise;
          if (!detailLoaded) continue;

          await new Promise(r => setTimeout(r, 2000));

          const boardResult = await sendMessageToTab(detailTabId, { action: 'extractBoardUrl' });
          if (boardResult && boardResult.url) {
            const saveResult = await saveBoardInternal(boardResult.url, boardResult.title || '直播大屏');
            if (saveResult.success) found++;
          }
        } finally {
          if (detailTabId !== null) {
            try { await chrome.tabs.remove(detailTabId); } catch (e) { /* 已关闭 */ }
          }
        }
      }

    } catch (e) {
      console.error('[千川看板] 处理账号出错:', aavid, e);
      skippedAccounts++;
    } finally {
      if (listTabId !== null) {
        try { await chrome.tabs.remove(listTabId); } catch (e) { /* 已关闭 */ }
      }
    }

    // 更新进度
    await chrome.storage.local.set({
      collectProgress: {
        status: 'running',
        startedAt: Date.now(),
        total: aavids.length,
        current: i + 1,
        found,
        skippedAccounts
      }
    });
  }

  // 5. 全部完成
  await chrome.storage.local.set({
    collectProgress: { status: 'done', total: aavids.length, found, skippedAccounts }
  });

  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

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

    default:
      sendResponse({ success: false, error: '未知 action: ' + action });
      return false;
  }
});

// ============================================
// Handler 函数
// ============================================

/**
 * 保存看板链接
 * @param {Object} data - { url: string, title: string }
 * @param {Function} sendResponse - 响应回调
 */
function handleSaveBoardUrl(data, sendResponse) {
  if (!data || !data.url) {
    sendResponse({ success: false, error: '缺少 URL 参数' });
    return;
  }

  chrome.storage.local.get(['boards'], (result) => {
    const boards = result.boards || [];

    // 检查是否已存在相同 URL
    const isDuplicate = boards.some(board => board.url === data.url);
    if (isDuplicate) {
      sendResponse({ success: false, error: '该链接已存在', count: boards.length });
      return;
    }

    // 创建新看板项
    const newBoard = {
      id: Date.now(),
      url: data.url,
      title: data.title || '未命名看板',
      timestamp: new Date().toISOString()
    };

    // 添加到数组并保存
    boards.push(newBoard);
    chrome.storage.local.set({ boards }, () => {
      sendResponse({ success: true, count: boards.length, board: newBoard });
    });
  });
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

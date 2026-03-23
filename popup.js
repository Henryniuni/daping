/**
 * 千川直播聚合看板 - Popup 脚本
 * 
 * 功能：
 * 1. 页面加载时获取已保存的看板数量
 * 2. 捕获当前大屏按钮：与 content script 通信提取当前页面
 * 3. 自动导航按钮：触发 background 的自动导航功能
 * 4. 打开看板按钮：在新标签页打开 dashboard.html
 */

(function() {
  'use strict';

  // ============================================
  // DOM 元素引用
  // ============================================

  const btnCapture = document.getElementById('btn-capture');
  const btnAuto = document.getElementById('btn-auto');
  const btnOpen = document.getElementById('btn-open');
  const btnAutoCollect = document.getElementById('btn-auto-collect');
  const collectProgressEl = document.getElementById('collect-progress');
  const boardCountEl = document.getElementById('board-count');

  let collectPollInterval = null;

  // ============================================
  // 初始化
  // ============================================

  document.addEventListener('DOMContentLoaded', () => {
    console.log('[千川看板 Popup] 页面加载完成');
    
    // 获取已保存的看板数量
    loadBoardCount();

    // 检测当前页面，决定是否显示自动采集按钮
    detectPageAndShowCollectBtn();

    // 绑定按钮事件
    bindEvents();
  });

  // ============================================
  // 数据加载
  // ============================================

  /**
   * 从 background 获取看板数量
   */
  function loadBoardCount() {
    chrome.runtime.sendMessage(
      { action: 'getBoards' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[千川看板 Popup] 获取数据失败:', chrome.runtime.lastError);
          updateCountDisplay(0);
          return;
        }

        if (response && response.success) {
          const count = response.boards ? response.boards.length : 0;
          updateCountDisplay(count);
        } else {
          updateCountDisplay(0);
        }
      }
    );
  }

  /**
   * 更新统计显示
   * @param {number} count - 看板数量
   */
  function updateCountDisplay(count) {
    boardCountEl.textContent = count;
  }

  // ============================================
  // 事件绑定
  // ============================================

  function bindEvents() {
    // 捕获当前大屏
    btnCapture.addEventListener('click', handleCapture);

    // 自动寻找并捕获
    btnAuto.addEventListener('click', handleAutoNavigate);

    // 打开聚合看板
    btnOpen.addEventListener('click', handleOpenDashboard);

    // 自动采集所有直播大屏（仅 ECP 页面显示）
    btnAutoCollect.addEventListener('click', handleAutoCollect);
  }

  // ============================================
  // 按钮处理函数
  // ============================================

  /**
   * 处理捕获按钮点击
   * 向当前标签页的 content script 发送提取指令
   */
  async function handleCapture() {
    console.log('[千川看板 Popup] 点击捕获按钮');

    try {
      // 获取当前活动标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        alert('❌ 无法获取当前标签页');
        return;
      }

      // 检查是否是千川页面
      const qianchuanUrls = ['qianchuan.jinritemai.com', 'buyin.jinritemai.com'];
      const isQianchuanPage = qianchuanUrls.some(url => tab.url && tab.url.includes(url));

      if (!isQianchuanPage) {
        alert('⚠️ 当前不是千川页面，请先打开千川网站');
        return;
      }

      // 向 content script 发送提取指令
      chrome.tabs.sendMessage(
        tab.id,
        { action: 'extractCurrentBoard' },
        (response) => {
          // 处理错误
          if (chrome.runtime.lastError) {
            console.error('[千川看板 Popup] 发送消息失败:', chrome.runtime.lastError);
            alert('❌ 无法访问页面，请刷新页面重试');
            return;
          }

          // 处理响应
          if (!response) {
            alert('❌ 页面无响应，请刷新重试');
            return;
          }

          switch (response.status) {
            case 'saved':
              alert('✅ 已保存当前大屏到看板');
              // 刷新数量显示
              loadBoardCount();
              break;

            case 'not_board_page':
              alert('⚠️ 当前不是大屏页面，请先进入直播间大屏');
              break;

            default:
              alert('❌ 未知状态，请刷新重试');
          }
        }
      );

    } catch (error) {
      console.error('[千川看板 Popup] 捕获失败:', error);
      alert('❌ 操作失败，请刷新页面重试');
    }
  }

  /**
   * 处理自动导航按钮点击
   * 触发 background 的自动导航功能
   */
  function handleAutoNavigate() {
    console.log('[千川看板 Popup] 点击自动导航按钮');

    chrome.runtime.sendMessage(
      { action: 'autoNavigate' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[千川看板 Popup] 自动导航失败:', chrome.runtime.lastError);
          alert('❌ 自动导航启动失败，请刷新页面重试');
          return;
        }

        if (response && response.success) {
          alert('🤖 已开始自动导航，请稍候...');
        } else {
          const errorMsg = response?.error || '自动导航失败';
          alert('❌ ' + errorMsg);
        }
      }
    );
  }

  /**
   * 处理打开看板按钮点击
   * 在新标签页打开 dashboard.html
   */
  function handleOpenDashboard() {
    console.log('[千川看板 Popup] 点击打开看板按钮');

    const dashboardUrl = chrome.runtime.getURL('dashboard.html');

    chrome.tabs.create({ url: dashboardUrl }, () => {
      window.close();
    });
  }

  // ============================================
  // 自动采集功能
  // ============================================

  /**
   * 检测当前页面，若为 ECP 页面则显示自动采集按钮
   * 同时恢复上次采集进度状态
   */
  async function detectPageAndShowCollectBtn() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('business.oceanengine.com')) {
      btnAutoCollect.style.display = '';
    }

    // 恢复上次进度状态（若仍在运行则自动恢复轮询）
    const { collectProgress } = await chrome.storage.local.get('collectProgress');
    if (collectProgress) {
      renderProgress(collectProgress);
      if (collectProgress.status === 'running') {
        // 检查是否过期（5分钟）
        if (Date.now() - (collectProgress.startedAt || 0) > 5 * 60 * 1000) {
          await chrome.storage.local.set({ collectProgress: { status: 'idle' } });
          renderProgress(null);
        } else {
          // 恢复轮询
          btnAutoCollect.disabled = true;
          startProgressPolling();
        }
      }
    }
  }

  /**
   * 处理自动采集按钮点击
   */
  async function handleAutoCollect() {
    console.log('[千川看板 Popup] 点击自动采集按钮');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    btnAutoCollect.disabled = true;

    chrome.runtime.sendMessage(
      { action: 'autoCollectBoards', data: { tabId: tab.id } },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          const err = (response && response.error) || '启动失败，请刷新页面重试';
          showProgress('❌ ' + err, 'error');
          btnAutoCollect.disabled = false;
          return;
        }
        startProgressPolling();
      }
    );
  }

  /**
   * 启动每秒轮询进度
   */
  function startProgressPolling() {
    if (collectPollInterval) clearInterval(collectPollInterval);
    collectPollInterval = setInterval(pollProgress, 1000);
  }

  /**
   * 轮询一次进度并更新显示
   */
  async function pollProgress() {
    const { collectProgress } = await chrome.storage.local.get('collectProgress');
    if (!collectProgress) return;

    // 检查过期
    if (collectProgress.status === 'running' &&
        Date.now() - (collectProgress.startedAt || 0) > 5 * 60 * 1000) {
      await chrome.storage.local.set({ collectProgress: { status: 'idle' } });
      clearInterval(collectPollInterval);
      collectPollInterval = null;
      btnAutoCollect.disabled = false;
      showProgress('⚠️ 上次采集已中断，请重新点击', 'warn');
      return;
    }

    renderProgress(collectProgress);

    if (collectProgress.status === 'done' || collectProgress.status === 'error') {
      clearInterval(collectPollInterval);
      collectPollInterval = null;
      btnAutoCollect.disabled = false;
      loadBoardCount();
    }
  }

  /**
   * 根据进度对象渲染进度区域
   * @param {Object|null} progress
   */
  function renderProgress(progress) {
    if (!progress || progress.status === 'idle') {
      collectProgressEl.style.display = 'none';
      return;
    }

    collectProgressEl.style.display = '';

    switch (progress.status) {
      case 'running':
        showProgress(
          `⏳ 正在检查 ${progress.current}/${progress.total} 个账号，已找到 ${progress.found} 个大屏...`,
          'running'
        );
        break;
      case 'done':
        showProgress(
          `✅ 完成！找到 ${progress.found} 个直播大屏（跳过 ${progress.skippedAccounts} 个账号）`,
          'done'
        );
        break;
      case 'error':
        showProgress('❌ ' + (progress.error || '采集失败'), 'error');
        break;
    }
  }

  /**
   * 显示进度文字
   * @param {string} text
   */
  function showProgress(text) {
    collectProgressEl.style.display = '';
    collectProgressEl.textContent = text;
  }

})();

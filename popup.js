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

  const btnOpen = document.getElementById('btn-open');
  const btnAutoCollect = document.getElementById('btn-auto-collect');
  const btnPause = document.getElementById('btn-pause');
  const btnCopyLog = document.getElementById('btn-copy-log');
  const collectProgressEl = document.getElementById('collect-progress');
  const boardCountEl = document.getElementById('board-count');

  let collectPollInterval = null;

  // ============================================
  // 初始化
  // ============================================

  document.addEventListener('DOMContentLoaded', () => {
    console.log('[千川看板 Popup] 页面加载完成');

    // 绑定按钮事件（必须最先执行，不受后续异步操作影响）
    bindEvents();

    // 获取已保存的看板数量
    try { loadBoardCount(); } catch (e) { /* 非扩展环境忽略 */ }

    // 恢复上次采集进度状态
    detectPageAndShowCollectBtn().catch(() => {});
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
    btnOpen.addEventListener('click', handleOpenDashboard);
    btnAutoCollect.addEventListener('click', handleAutoCollect);
    btnPause.addEventListener('click', handlePauseResume);
    btnCopyLog.addEventListener('click', handleCopyLog);
  }

  // ============================================
  // 按钮处理函数
  // ============================================

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
   * 恢复上次采集进度状态
   */
  async function detectPageAndShowCollectBtn() {
    const { collectProgress } = await chrome.storage.local.get('collectProgress');
    if (collectProgress) {
      renderProgress(collectProgress);
      if (collectProgress.status === 'running') {
        if (Date.now() - (collectProgress.startedAt || 0) > 5 * 60 * 1000) {
          await chrome.storage.local.set({ collectProgress: { status: 'idle' } });
          renderProgress(null);
        } else {
          btnAutoCollect.disabled = true;
          btnPause.style.display = '';
          startProgressPolling();
        }
      }
    }
  }

  /**
   * 暂停 / 继续采集
   */
  async function handlePauseResume() {
    const { collectPaused } = await chrome.storage.local.get('collectPaused');
    if (collectPaused) {
      // 当前暂停 → 继续
      await chrome.storage.local.set({ collectPaused: false });
      btnPause.textContent = '⏸ 暂停采集';
      btnPause.classList.remove('resuming');
    } else {
      // 当前运行 → 暂停
      await chrome.storage.local.set({ collectPaused: true });
      btnPause.textContent = '▶ 继续采集';
      btnPause.classList.add('resuming');
    }
  }

  /**
   * 处理自动采集按钮点击
   */
  async function handleAutoCollect() {
    console.log('[千川看板 Popup] 点击自动采集按钮');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        showProgress('❌ 无法获取当前标签页，请重试', 'error');
        return;
      }

      btnAutoCollect.disabled = true;
      await chrome.storage.local.set({ collectPaused: false });

      chrome.runtime.sendMessage(
        { action: 'autoCollectBoards', data: { tabId: tab.id } },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            const err = (response && response.error) || '启动失败，请刷新页面重试';
            showProgress('❌ ' + err, 'error');
            btnAutoCollect.disabled = false;
            return;
          }
          btnPause.style.display = '';
          btnPause.textContent = '⏸ 暂停采集';
          btnPause.classList.remove('resuming');
          startProgressPolling();
        }
      );
    } catch (e) {
      showProgress('❌ ' + (e.message || '启动失败'), 'error');
      btnAutoCollect.disabled = false;
    }
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
      btnPause.style.display = 'none';
      await chrome.storage.local.set({ collectPaused: false });
      loadBoardCount();
    }
  }

  /**
   * 根据进度对象渲染日志面板
   * @param {Object|null} progress
   */
  async function handleCopyLog() {
    const { collectProgress } = await chrome.storage.local.get('collectProgress');
    const logs = (collectProgress && collectProgress.logs) || [];
    const text = logs.map(l => l.text).join('\n');
    await navigator.clipboard.writeText(text || '（无日志）');
    btnCopyLog.textContent = '✅ 已复制';
    setTimeout(() => { btnCopyLog.textContent = '📋 复制日志'; }, 2000);
  }

  function renderProgress(progress) {
    if (!progress || progress.status === 'idle') {
      collectProgressEl.style.display = 'none';
      btnCopyLog.style.display = 'none';
      return;
    }

    collectProgressEl.style.display = '';
    btnCopyLog.style.display = '';
    collectProgressEl.className = 'collect-progress' +
      (progress.status === 'done' ? ' done' : progress.status === 'error' ? ' error' : '');

    const logs = progress.logs || [];

    // 尾部状态行
    let statusLine = '';
    if (progress.status === 'done') {
      const total = (progress.found || 0) + (progress.foundDup || 0);
      const newPart = progress.found ? `新增 ${progress.found} 个` : '';
      const dupPart = progress.foundDup ? `已存在 ${progress.foundDup} 个` : '';
      const detail = [newPart, dupPart].filter(Boolean).join('，') || '未发现大屏';
      statusLine = `✅ 完成！共发现 ${total} 个大屏（${detail}）`;
    } else if (progress.status === 'running') {
      const total = (progress.found || 0) + (progress.foundDup || 0);
      statusLine = `⏳ 采集中，已发现 ${total} 个大屏...`;
    }

    // 渲染日志行（只在内容变化时重绘，避免滚动跳动）
    const newHtml = logs.map(({ text, type }) => {
      const cls = type === 'success' ? 'log-success' : type === 'skip' ? 'log-skip' : type === 'error' ? 'log-error' : 'log-info';
      return `<div class="${cls}">${escapeHtml(text)}</div>`;
    }).join('') + (statusLine ? `<div class="log-status">${escapeHtml(statusLine)}</div>` : '');

    if (collectProgressEl.innerHTML !== newHtml) {
      collectProgressEl.innerHTML = newHtml;
      // 自动滚到最新日志
      collectProgressEl.scrollTop = collectProgressEl.scrollHeight;
    }
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 显示单行提示（用于错误/警告等非日志场景）
   * @param {string} text
   * @param {string} [type]
   */
  function showProgress(text, type) {
    collectProgressEl.style.display = '';
    collectProgressEl.innerHTML = `<div class="log-${type || 'info'}">${escapeHtml(text)}</div>`;
    collectProgressEl.className = 'collect-progress' + (type && type !== 'running' ? ' ' + type : '');
  }

})();

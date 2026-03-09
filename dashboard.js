/**
 * 千川直播聚合监控中心 - Dashboard 脚本
 * 
 * 功能：
 * 1. 加载并展示已保存的直播间看板
 * 2. 支持多种 Grid 布局切换（1×1, 2×2, 3×3, 4×4）
 * 3. 支持单个/全部刷新、删除、新标签页打开
 * 4. iframe 嵌入千川大屏页面，自动缩放适应容器
 * 5. 智能缩放：当缩放比例过小时自动切换为滚动模式
 */

(function() {
  'use strict';

  // ============================================
  // 全局变量
  // ============================================

  let boards = [];
  let currentLayout = 2;

  // 千川大屏设计分辨率（标准 1920x1080）
  const DESIGN_WIDTH = 1920;
  const DESIGN_HEIGHT = 1080;
  
  // 缩放阈值：小于此值时切换为滚动模式
  const SCALE_THRESHOLD = 0.5;

  // ============================================
  // DOM 元素引用
  // ============================================

  const container = document.getElementById('container');
  const layoutSelect = document.getElementById('layout-select');
  const btnRefreshAll = document.getElementById('btn-refresh-all');
  const btnClearAll = document.getElementById('btn-clear-all');

  // ============================================
  // 初始化
  // ============================================

  document.addEventListener('DOMContentLoaded', () => {
    console.log('[千川看板 Dashboard] 页面加载完成');
    
    // 加载看板数据
    loadBoards();
    
    // 绑定事件
    bindEvents();
    
    // 绑定窗口大小改变监听（防抖）
    bindResizeListener();
  });

  // ============================================
  // 事件绑定
  // ============================================

  function bindEvents() {
    // 布局选择器变化
    layoutSelect.addEventListener('change', () => {
      currentLayout = parseInt(layoutSelect.value, 10);
      changeLayout();
    });

    // 全部刷新按钮
    btnRefreshAll.addEventListener('click', refreshAll);

    // 清空全部按钮
    btnClearAll.addEventListener('click', clearAll);
  }

  /**
   * 绑定窗口大小改变监听
   * 使用防抖优化性能
   */
  function bindResizeListener() {
    if (window._resizeListenerBound) return;
    
    window.addEventListener('resize', () => {
      // 清除之前的定时器
      if (window._resizeTimer) {
        clearTimeout(window._resizeTimer);
      }
      // 延迟执行缩放调整
      window._resizeTimer = setTimeout(() => {
        requestAnimationFrame(adjustIframeScale);
      }, 200);
    });
    
    window._resizeListenerBound = true;
  }

  // ============================================
  // 核心功能函数
  // ============================================

  /**
   * 加载看板数据
   * 从 background 获取 boards 数组
   */
  function loadBoards() {
    chrome.runtime.sendMessage(
      { action: 'getBoards' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[千川看板 Dashboard] 获取数据失败:', chrome.runtime.lastError);
          boards = [];
          renderBoards();
          return;
        }

        if (response && response.success) {
          boards = response.boards || [];
          console.log('[千川看板 Dashboard] 加载看板数量:', boards.length);
          renderBoards();
        } else {
          console.error('[千川看板 Dashboard] 获取数据失败:', response?.error);
          boards = [];
          renderBoards();
        }
      }
    );
  }

  /**
   * 渲染看板列表
   * 根据 boards 数据创建 grid-item 卡片
   */
  function renderBoards() {
    // 清空容器
    container.innerHTML = '';

    // 如果没有数据，显示空状态
    if (boards.length === 0) {
      showEmptyState();
      return;
    }

    // 遍历 boards 创建卡片
    boards.forEach((board, index) => {
      const gridItem = createGridItem(board, index + 1);
      container.appendChild(gridItem);
    });

    // 应用当前布局
    changeLayout();
  }

  /**
   * 显示空状态
   */
  function showEmptyState() {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <div class="empty-icon">📭</div>
      <div class="empty-title">暂无直播间数据</div>
      <div class="empty-tip">请在千川页面点击插件图标，选择"捕获当前大屏"</div>
    `;
    container.appendChild(emptyState);
  }

  /**
   * 创建单个 Grid Item 卡片
   * @param {Object} board - 看板数据 {id, url, title, timestamp}
   * @param {number} index - 序号（从1开始）
   * @returns {HTMLElement} grid-item 元素
   */
  function createGridItem(board, index) {
    const item = document.createElement('div');
    item.className = 'grid-item';
    item.dataset.id = board.id;

    // 创建 header
    const header = document.createElement('div');
    header.className = 'item-header';
    
    // 标题区域（包含序号、标题、缩放比例）
    const titleArea = document.createElement('div');
    titleArea.className = 'item-title-area';
    titleArea.style.cssText = 'display: flex; align-items: center; overflow: hidden; flex: 1;';
    
    const indexSpan = document.createElement('span');
    indexSpan.className = 'item-index';
    indexSpan.textContent = `#${index}`;
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'item-title';
    titleSpan.textContent = board.title;
    titleSpan.title = board.title; // 悬停显示完整标题
    
    // 缩放比例显示
    const scaleDisplay = document.createElement('span');
    scaleDisplay.className = 'scale-display';
    scaleDisplay.dataset.boardId = board.id;
    scaleDisplay.style.cssText = 'font-size: 11px; color: #8b92b9; margin-left: 8px; flex-shrink: 0;';
    scaleDisplay.textContent = '计算中...';
    
    titleArea.appendChild(indexSpan);
    titleArea.appendChild(titleSpan);
    titleArea.appendChild(scaleDisplay);
    
    // 操作按钮区域
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    
    const btnRefresh = createIconButton('🔄', '刷新', () => refreshItem(board.id));
    const btnOpen = createIconButton('↗️', '新标签页打开', () => openNewTab(board.url));
    const btnRemove = createIconButton('✕', '删除', () => removeItem(board.id));
    
    actions.appendChild(btnRefresh);
    actions.appendChild(btnOpen);
    actions.appendChild(btnRemove);
    
    header.appendChild(titleArea);
    header.appendChild(actions);

    // 创建 iframe 容器（用于缩放控制）
    const iframeWrapper = document.createElement('div');
    iframeWrapper.className = 'iframe-wrapper';

    // 创建 iframe
    const iframe = document.createElement('iframe');
    iframe.src = board.url;
    iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms';
    iframe.id = `iframe-${board.id}`;
    iframe.style.cssText = `
      border: none;
      background: #000;
      transform-origin: top left;
      position: absolute;
      top: 0;
      left: 0;
    `;

    // 创建 loading 提示
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.id = `loading-${board.id}`;
    loading.textContent = '加载中...';

    // iframe 加载完成后处理
    iframe.addEventListener('load', () => {
      // 移除 loading
      const loadingEl = document.getElementById(`loading-${board.id}`);
      if (loadingEl) {
        loadingEl.remove();
      }
      
      // 延迟应用缩放，确保容器尺寸已确定
      setTimeout(() => {
        adjustIframeScaleForItem(item, board.id);
      }, 100);
    });

    // 组装结构
    iframeWrapper.appendChild(iframe);
    item.appendChild(header);
    item.appendChild(iframeWrapper);
    item.appendChild(loading);

    return item;
  }

  /**
   * 创建图标按钮
   * @param {string} icon - 图标字符
   * @param {string} title - 按钮标题（tooltip）
   * @param {Function} onClick - 点击回调
   * @returns {HTMLElement} 按钮元素
   */
  function createIconButton(icon, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.innerHTML = icon;
    btn.title = title;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return btn;
  }

  // ============================================
  // 自适应缩放功能
  // ============================================

  /**
   * 调整所有 iframe 的缩放比例
   * 遍历所有 grid-item 并应用缩放
   */
  function adjustIframeScale() {
    const items = document.querySelectorAll('.grid-item');
    items.forEach(item => {
      const boardId = item.dataset.id;
      if (boardId) {
        adjustIframeScaleForItem(item, parseInt(boardId, 10));
      }
    });
  }

  /**
   * 设置 iframe 缩放（完整展示在固定高度内）
   * @param {HTMLElement} item - grid-item 元素
   * @param {number} boardId - 看板 ID
   */
  function adjustIframeScaleForItem(item, boardId) {
    const iframe = item.querySelector('iframe');
    const iframeWrapper = item.querySelector('.iframe-wrapper');
    const scaleDisplay = item.querySelector('.scale-display');
    
    if (!iframe || !iframeWrapper) return;

    // 获取容器实际尺寸
    const containerWidth = iframeWrapper.clientWidth;
    const containerHeight = iframeWrapper.clientHeight;

    if (containerWidth === 0 || containerHeight === 0) {
      console.warn(`[千川助手] 容器尺寸为0，跳过: #${boardId}`);
      return;
    }

    // 计算缩放比例（取宽高中较小的比例，确保完整显示）
    const scaleX = containerWidth / DESIGN_WIDTH;
    const scaleY = containerHeight / DESIGN_HEIGHT;
    const scale = Math.min(scaleX, scaleY);

    // 更新缩放比例显示
    if (scaleDisplay) {
      const scalePercent = (scale * 100).toFixed(0);
      scaleDisplay.textContent = `${scalePercent}%`;
    }

    // 设置 iframe 原始尺寸，然后应用缩放
    // 这样 1920x1080 的内容会完整显示在固定高度的卡片内
    iframe.style.width = DESIGN_WIDTH + 'px';
    iframe.style.height = DESIGN_HEIGHT + 'px';
    iframe.style.transform = `scale(${scale})`;
    
    // wrapper 裁剪溢出部分
    iframeWrapper.style.overflow = 'hidden';
      
    console.log(`[千川助手] 看板 #${boardId} 缩放: ${(scale * 100).toFixed(0)}%, 容器: ${containerWidth}x${containerHeight}`);
  }

  // ============================================
  // 布局管理
  // ============================================

  /**
   * 切换布局
   * 根据 currentLayout 值应用对应的 CSS 类，并重新计算 iframe 尺寸
   */
  function changeLayout() {
    // 移除旧的布局类
    container.classList.remove('layout-1', 'layout-2', 'layout-3', 'layout-4');
    
    // 添加新的布局类
    container.classList.add(`layout-${currentLayout}`);

    console.log('[千川看板 Dashboard] 切换布局:', currentLayout + '×' + currentLayout);

    // 布局切换后重新计算 iframe 尺寸（延迟确保渲染完成）
    setTimeout(() => {
      requestAnimationFrame(adjustIframeScale);
    }, 300);
  }

  // ============================================
  // 看板操作函数
  // ============================================

  /**
   * 刷新单个 iframe
   * @param {number} id - 看板 ID
   */
  function refreshItem(id) {
    const iframe = document.getElementById(`iframe-${id}`);
    const gridItem = document.querySelector(`.grid-item[data-id="${id}"]`);
    
    if (!iframe || !gridItem) return;

    // 重新显示 loading
    const existingLoading = gridItem.querySelector('.loading');
    if (!existingLoading) {
      const loading = document.createElement('div');
      loading.className = 'loading';
      loading.id = `loading-${id}`;
      loading.textContent = '加载中...';
      gridItem.appendChild(loading);
    }

    // 刷新 iframe
    iframe.src = iframe.src;
    console.log('[千川看板 Dashboard] 刷新看板:', id);
  }

  /**
   * 刷新所有 iframe
   */
  function refreshAll() {
    console.log('[千川看板 Dashboard] 刷新全部看板');
    boards.forEach(board => {
      refreshItem(board.id);
    });
  }

  /**
   * 删除单个看板
   * @param {number} id - 看板 ID
   */
  function removeItem(id) {
    const board = boards.find(b => b.id === id);
    const title = board ? board.title : '该看板';

    if (!confirm(`确定要删除"${title}"吗？`)) {
      return;
    }

    chrome.runtime.sendMessage(
      { action: 'deleteBoard', data: { id } },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[千川看板 Dashboard] 删除失败:', chrome.runtime.lastError);
          alert('删除失败，请重试');
          return;
        }

        if (response && response.success) {
          console.log('[千川看板 Dashboard] 删除成功:', id);
          loadBoards(); // 重新加载列表
        } else {
          console.error('[千川看板 Dashboard] 删除失败:', response?.error);
          alert('删除失败: ' + (response?.error || '未知错误'));
        }
      }
    );
  }

  /**
   * 清空所有看板
   */
  function clearAll() {
    if (boards.length === 0) {
      alert('当前没有保存的看板');
      return;
    }

    if (!confirm(`确定要清空全部 ${boards.length} 个看板吗？此操作不可恢复。`)) {
      return;
    }

    chrome.runtime.sendMessage(
      { action: 'clearAll' },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[千川看板 Dashboard] 清空失败:', chrome.runtime.lastError);
          alert('清空失败，请重试');
          return;
        }

        if (response && response.success) {
          console.log('[千川看板 Dashboard] 清空成功');
          loadBoards(); // 重新加载列表
        } else {
          console.error('[千川看板 Dashboard] 清空失败:', response?.error);
          alert('清空失败: ' + (response?.error || '未知错误'));
        }
      }
    );
  }

  /**
   * 在新标签页打开 URL
   * @param {string} url - 目标 URL
   */
  function openNewTab(url) {
    window.open(url, '_blank');
  }

  // ============================================
  // 工具函数
  // ============================================

  /**
   * HTML 转义，防止 XSS
   * @param {string} text - 原始文本
   * @returns {string} 转义后的文本
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

})();

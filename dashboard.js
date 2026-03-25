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
  let currentLayout = 1;

  // 千川大屏设计分辨率（标准 1920x1080）
  const DESIGN_WIDTH = 1920;
  const DESIGN_HEIGHT = 1080;
  
  // 缩放阈值：小于此值时切换为滚动模式
  const SCALE_THRESHOLD = 0.5;

  // 拖拽相关变量
  let draggedItem = null;
  let draggedBoardId = null;
  let dragOverItem = null;

  // 转写状态 Map：boardId → { ws, audioCtx, stream, finalText }
  const transcriptionMap = new Map();

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

    // ASR 设置弹窗
    const modal = document.getElementById('asr-settings-modal');
    document.getElementById('btn-asr-settings').addEventListener('click', () => {
      // 回填已保存的值
      chrome.storage.local.get('asrCredentials', ({ asrCredentials }) => {
        if (asrCredentials) {
          document.getElementById('asr-appid').value = asrCredentials.appId || '';
          document.getElementById('asr-secretid').value = asrCredentials.secretId || '';
          document.getElementById('asr-secretkey').value = asrCredentials.secretKey || '';
        }
      });
      modal.style.display = 'flex';
    });

    document.getElementById('btn-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    document.getElementById('btn-asr-save').addEventListener('click', () => {
      const appId = document.getElementById('asr-appid').value.trim();
      const secretId = document.getElementById('asr-secretid').value.trim();
      const secretKey = document.getElementById('asr-secretkey').value.trim();
      if (!appId || !secretId || !secretKey) {
        alert('请填写全部三项凭证');
        return;
      }
      chrome.storage.local.set({ asrCredentials: { appId, secretId, secretKey } }, () => {
        modal.style.display = 'none';
        console.log('[千川看板] ASR 凭证已保存');
      });
    });

    document.getElementById('btn-asr-clear').addEventListener('click', () => {
      if (!confirm('确定清除已保存的 ASR 凭证？')) return;
      chrome.storage.local.remove('asrCredentials', () => {
        document.getElementById('asr-appid').value = '';
        document.getElementById('asr-secretid').value = '';
        document.getElementById('asr-secretkey').value = '';
        modal.style.display = 'none';
      });
    });

    // 违规词弹窗
    const fwModal = document.getElementById('forbidden-words-modal');
    const fwTextarea = document.getElementById('fw-textarea');
    const fwCount = document.getElementById('fw-count');

    function updateFwCount() {
      const words = parseFwTextarea();
      fwCount.textContent = `共 ${words.length} 个词`;
    }

    function parseFwTextarea() {
      return fwTextarea.value.split('\n').map(w => w.trim()).filter(w => w.length > 0);
    }

    document.getElementById('btn-forbidden-words').addEventListener('click', () => {
      chrome.storage.local.get('forbiddenWords', ({ forbiddenWords }) => {
        fwTextarea.value = (forbiddenWords || []).join('\n');
        updateFwCount();
        fwModal.style.display = 'flex';
      });
    });

    document.getElementById('btn-fw-close').addEventListener('click', () => {
      fwModal.style.display = 'none';
    });

    fwModal.addEventListener('click', (e) => {
      if (e.target === fwModal) fwModal.style.display = 'none';
    });

    fwTextarea.addEventListener('input', updateFwCount);

    // 从文件导入（.txt / .xlsx / .xls）
    document.getElementById('fw-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'txt') {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const lines = ev.target.result.split(/\r?\n/).map(w => w.trim()).filter(w => w.length > 0);
          mergeIntoTextarea(lines);
        };
        reader.readAsText(file, 'utf-8');
      } else if (ext === 'xlsx' || ext === 'xls') {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const workbook = XLSX.read(ev.target.result, { type: 'array' });
            const words = [];
            workbook.SheetNames.forEach(sheetName => {
              const sheet = workbook.Sheets[sheetName];
              const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
              rows.forEach(row => {
                row.forEach(cell => {
                  const val = String(cell ?? '').trim();
                  if (val) words.push(val);
                });
              });
            });
            mergeIntoTextarea(words);
          } catch (err) {
            alert('Excel 解析失败：' + err.message);
          }
        };
        reader.readAsArrayBuffer(file);
      }

      e.target.value = '';
    });

    function mergeIntoTextarea(newWords) {
      const existing = parseFwTextarea();
      const merged = [...new Set([...existing, ...newWords])];
      fwTextarea.value = merged.join('\n');
      updateFwCount();
    }

    document.getElementById('btn-fw-save').addEventListener('click', () => {
      const words = parseFwTextarea();
      chrome.storage.local.set({ forbiddenWords: words }, () => {
        fwModal.style.display = 'none';
        console.log('[千川看板] 违规词已保存，共', words.length, '个');
      });
    });

    document.getElementById('btn-fw-clear').addEventListener('click', () => {
      if (!confirm('确定清空全部违规词？')) return;
      chrome.storage.local.remove('forbiddenWords', () => {
        fwTextarea.value = '';
        updateFwCount();
        fwModal.style.display = 'none';
      });
    });
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
    
    // 标题区域（包含拖拽手柄、序号、标题、缩放比例）
    const titleArea = document.createElement('div');
    titleArea.className = 'item-title-area';
    titleArea.style.cssText = 'display: flex; align-items: center; overflow: hidden; flex: 1;';
    
    // 拖拽手柄
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '⋮⋮'; // 拖拽图标
    dragHandle.title = '拖拽排序';
    
    const indexSpan = document.createElement('span');
    indexSpan.className = 'item-index';
    indexSpan.textContent = `#${index}`;
    
    titleArea.appendChild(dragHandle);
    
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

    // 麦克风按钮（仅 1×1 布局可见）
    const btnMic = document.createElement('button');
    btnMic.className = 'btn-mic';
    btnMic.title = '开始/停止语音转写';
    btnMic.textContent = '🎤';
    btnMic.addEventListener('click', (e) => {
      e.preventDefault();
      toggleTranscription(item, board.id);
    });

    actions.appendChild(btnRefresh);
    actions.appendChild(btnOpen);
    actions.appendChild(btnMic);
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

    // 创建转写覆盖层
    const transcriptOverlay = document.createElement('div');
    transcriptOverlay.className = 'transcript-overlay';
    transcriptOverlay.style.display = 'none';

    // 顶部工具栏
    const transcriptToolbar = document.createElement('div');
    transcriptToolbar.className = 'transcript-toolbar';
    const btnDownload = document.createElement('button');
    btnDownload.className = 'transcript-btn';
    btnDownload.title = '下载转写文本';
    btnDownload.textContent = '⬇ 下载';
    btnDownload.addEventListener('click', () => downloadTranscript(board.id, board.title));
    transcriptToolbar.appendChild(btnDownload);
    transcriptOverlay.appendChild(transcriptToolbar);

    const transcriptText = document.createElement('div');
    transcriptText.className = 'transcript-text';
    transcriptOverlay.appendChild(transcriptText);
    iframeWrapper.appendChild(transcriptOverlay);

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

    // 添加拖拽功能
    addDragListeners(item);

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

    // 1×1 布局时更新转写覆盖层位置
    const overlay = iframeWrapper.querySelector('.transcript-overlay');
    if (overlay && currentLayout === 1) {
      const iframeRight = Math.round(DESIGN_WIDTH * scale);
      const wrapperWidth = containerWidth;
      const overlayWidth = wrapperWidth - iframeRight;
      if (overlayWidth > 40) {
        overlay.style.left = iframeRight + 'px';
        overlay.style.width = overlayWidth + 'px';
        overlay.style.height = '100%';
        overlay.style.top = '0';
      }
    }

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

    // 处理转写功能的显示/隐藏
    if (currentLayout !== 1) {
      // 非 1×1 布局：停止所有转写，隐藏覆盖层
      transcriptionMap.forEach((state, boardId) => {
        stopTranscription(boardId);
      });
      document.querySelectorAll('.transcript-overlay').forEach(el => {
        el.style.display = 'none';
      });
    }

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

  // ============================================
  // 拖拽排序功能
  // ============================================

  /**
   * 为 grid-item 添加拖拽事件监听
   * @param {HTMLElement} item - grid-item 元素
   */
  function addDragListeners(item) {
    // 使用 header 作为拖拽手柄
    const header = item.querySelector('.item-header');
    
    item.setAttribute('draggable', 'true');
    
    // 拖拽开始
    item.addEventListener('dragstart', handleDragStart);
    
    // 拖拽结束
    item.addEventListener('dragend', handleDragEnd);
    
    // 拖拽经过
    item.addEventListener('dragover', handleDragOver);
    
    // 拖拽进入
    item.addEventListener('dragenter', handleDragEnter);
    
    // 拖拽离开
    item.addEventListener('dragleave', handleDragLeave);
    
    // 放置
    item.addEventListener('drop', handleDrop);
  }

  /**
   * 拖拽开始
   */
  function handleDragStart(e) {
    draggedItem = this;
    draggedBoardId = parseInt(this.dataset.id, 10);
    
    // 添加拖拽中样式
    this.classList.add('dragging');
    
    // 设置拖拽数据
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedBoardId);
    
    console.log('[千川助手] 开始拖拽:', draggedBoardId);
  }

  /**
   * 拖拽结束
   */
  function handleDragEnd(e) {
    // 移除拖拽中样式
    this.classList.remove('dragging');
    
    // 移除所有 drag-over 样式
    document.querySelectorAll('.grid-item.drag-over').forEach(item => {
      item.classList.remove('drag-over');
    });
    
    draggedItem = null;
    draggedBoardId = null;
    dragOverItem = null;
    
    console.log('[千川助手] 拖拽结束');
  }

  /**
   * 拖拽经过
   */
  function handleDragOver(e) {
    e.preventDefault(); // 允许放置
    e.dataTransfer.dropEffect = 'move';
  }

  /**
   * 拖拽进入
   */
  function handleDragEnter(e) {
    e.preventDefault();
    
    if (this !== draggedItem) {
      this.classList.add('drag-over');
      dragOverItem = this;
    }
  }

  /**
   * 拖拽离开
   */
  function handleDragLeave(e) {
    // 检查是否真的离开了元素（而不是进入了子元素）
    if (!this.contains(e.relatedTarget)) {
      this.classList.remove('drag-over');
    }
  }

  /**
   * 放置
   */
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 移除 drag-over 样式
    this.classList.remove('drag-over');
    
    if (this === draggedItem) {
      return; // 不能放置到自己
    }
    
    const targetBoardId = parseInt(this.dataset.id, 10);
    
    if (!draggedBoardId || !targetBoardId) {
      return;
    }
    
    console.log('[千川助手] 放置:', draggedBoardId, '->', targetBoardId);
    
    // 交换位置
    swapBoards(draggedBoardId, targetBoardId);
  }

  /**
   * 交换两个看板的位置
   * @param {number} sourceId - 源看板 ID
   * @param {number} targetId - 目标看板 ID
   */
  function swapBoards(sourceId, targetId) {
    const sourceIndex = boards.findIndex(b => b.id === sourceId);
    const targetIndex = boards.findIndex(b => b.id === targetId);
    
    if (sourceIndex === -1 || targetIndex === -1) {
      console.error('[千川助手] 找不到看板:', sourceId, targetId);
      return;
    }
    
    // 交换数组中的位置
    [boards[sourceIndex], boards[targetIndex]] = [boards[targetIndex], boards[sourceIndex]];
    
    console.log('[千川助手] 交换位置:', sourceIndex, '<->', targetIndex);
    
    // 保存新的顺序到 storage
    saveBoardsOrder();
    
    // 重新渲染
    renderBoards();
  }

  // ============================================
  // 语音转写功能
  // ============================================

  /**
   * 切换转写状态
   * @param {HTMLElement} item - grid-item 元素
   * @param {number} boardId - 看板 ID
   */
  function toggleTranscription(item, boardId) {
    if (transcriptionMap.has(boardId)) {
      stopTranscription(boardId);
    } else {
      startTranscription(item, boardId);
    }
  }

  /**
   * 开始转写
   * @param {HTMLElement} item - grid-item 元素
   * @param {number} boardId - 看板 ID
   */
  async function startTranscription(item, boardId) {
    const btnMic = item.querySelector('.btn-mic');
    const overlay = item.querySelector('.transcript-overlay');

    if (!btnMic || !overlay) return;

    try {
      // 1. 使用 getDisplayMedia 捕获当前标签页音频
      // （tabCapture 无法捕获 chrome-extension:// 页面，故改用此方案）
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,   // Chrome 要求必须请求 video
        audio: {
          suppressLocalAudioPlayback: false,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        preferCurrentTab: true
      });

      // 立即停止视频轨道，只保留音频
      displayStream.getVideoTracks().forEach(t => t.stop());

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('未获取到音频轨道，请在分享对话框中勾选"分享音频"');
      }

      const stream = new MediaStream(audioTracks);

      // 3. 创建 AudioContext（16kHz）并连接处理节点
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);

      // 4. 连接到静音增益节点，避免双重播放
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      source.connect(processor);

      // 5. 创建 WebSocket 连接
      const ws = await connectTencentASR(
        (finalText, interimText) => {
          renderTranscript(overlay, finalText, interimText);
        },
        (errMsg) => {
          const textEl = overlay.querySelector('.transcript-text');
          if (textEl) {
            const errEl = document.createElement('span');
            errEl.className = 'transcript-error';
            errEl.textContent = '⚠️ ' + errMsg;
            textEl.appendChild(errEl);
          }
        }
      );

      // 6. 音频处理：发送 PCM 数据给 WebSocket
      processor.onaudioprocess = (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          const float32 = e.inputBuffer.getChannelData(0);
          const pcm = float32ToPCM16(float32);
          ws.send(pcm);
        }
      };

      // 7. 保存状态
      transcriptionMap.set(boardId, { ws, audioCtx, stream, processor, finalText: '' });

      // 8. 更新 UI
      btnMic.classList.add('active');
      overlay.style.display = 'flex';
      // 更新覆盖层位置
      adjustIframeScaleForItem(item, boardId);

    } catch (err) {
      console.error('[千川看板] 转写启动失败:', err);
      const overlay2 = item.querySelector('.transcript-overlay');
      if (overlay2) {
        overlay2.style.display = 'flex';
        const textEl = overlay2.querySelector('.transcript-text');
        if (textEl) {
          const errEl = document.createElement('span');
          errEl.className = 'transcript-error';
          errEl.textContent = '⚠️ 启动失败: ' + err.message;
          textEl.appendChild(errEl);
        }
      }
    }
  }

  /**
   * 停止转写
   * @param {number} boardId - 看板 ID
   */
  function stopTranscription(boardId) {
    const state = transcriptionMap.get(boardId);
    if (!state) return;

    const { ws, audioCtx, stream, processor } = state;

    // 关闭 WebSocket
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      try { ws.close(); } catch (e) { /* ignore */ }
    }

    // 断开 processor
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch (e) { /* ignore */ }
    }

    // 关闭 AudioContext
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }

    // 停止媒体轨道
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }

    transcriptionMap.delete(boardId);

    // 更新 UI
    const item = document.querySelector(`.grid-item[data-id="${boardId}"]`);
    if (item) {
      const btnMic = item.querySelector('.btn-mic');
      if (btnMic) btnMic.classList.remove('active');
      // overlay 保留（历史文字不清空）
    }
  }

  /**
   * 渲染转写文字到覆盖层
   * @param {HTMLElement} overlay
   * @param {string} finalText - 所有已确认文字
   * @param {string} interimText - 当前中间结果
   */
  function renderTranscript(overlay, finalText, interimText) {
    const textEl = overlay.querySelector('.transcript-text');
    if (!textEl) return;

    chrome.storage.local.get('forbiddenWords', ({ forbiddenWords }) => {
      const words = forbiddenWords || [];
      textEl.innerHTML = '';

      if (finalText) {
        const finalEl = document.createElement('span');
        finalEl.className = 'final';
        finalEl.innerHTML = highlightForbiddenWords(finalText, words);
        textEl.appendChild(finalEl);
      }

      if (interimText) {
        const interimEl = document.createElement('span');
        interimEl.className = 'interim';
        interimEl.innerHTML = highlightForbiddenWords(interimText, words);
        textEl.appendChild(interimEl);
      }

      // 自动滚底（rAF 等 DOM 重排完成后再滚）
      requestAnimationFrame(() => {
        overlay.scrollTop = overlay.scrollHeight;
      });
    });
  }

  /**
   * 将文本中的违规词包裹为红色高亮 HTML
   * @param {string} text
   * @param {string[]} words
   * @returns {string} 安全的 HTML 字符串
   */
  function highlightForbiddenWords(text, words) {
    if (!words || words.length === 0) return escapeHtml(text);

    // 按长度降序排，避免短词先匹配覆盖长词
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'g');

    return text.split(regex).map(part => {
      if (words.includes(part)) {
        return `<span class="highlight-word">${escapeHtml(part)}</span>`;
      }
      return escapeHtml(part);
    }).join('');
  }

  /**
   * 连接腾讯云实时语音识别 WebSocket
   * @param {Function} onResult - (finalText, interimText) => void
   * @param {Function} onError - (errMsg) => void
   * @returns {Promise<WebSocket>}
   */
  async function connectTencentASR(onResult, onError) {
    // 从 storage 读取用户填写的凭证
    const stored = await new Promise(resolve =>
      chrome.storage.local.get('asrCredentials', ({ asrCredentials }) => resolve(asrCredentials))
    );
    if (!stored || !stored.appId || !stored.secretId || !stored.secretKey) {
      throw new Error('请先点击顶部"⚙️ ASR 设置"填写腾讯云凭证');
    }
    const base = typeof TENCENT_ASR_CONFIG !== 'undefined' ? TENCENT_ASR_CONFIG : {};
    const cfg = { ...base, ...stored };

    const params = {
      secretid: cfg.secretId,
      timestamp: Math.floor(Date.now() / 1000),
      expired: Math.floor(Date.now() / 1000) + 86400,
      nonce: Math.floor(Math.random() * 100000),
      engine_model_type: cfg.engineModelType,
      voice_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      voice_format: 1,        // PCM
      needvad: 1,
      vad_silence_time: 600,
      word_info: 0
    };

    // 按 key 字典序排列构造签名原文
    const sortedKeys = Object.keys(params).sort();
    const queryStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
    const signSrc = `asr.cloud.tencent.com/asr/v2/${cfg.appId}?${queryStr}`;

    // HMAC-SHA1 签名
    const keyBytes = new TextEncoder().encode(cfg.secretKey);
    const msgBytes = new TextEncoder().encode(signSrc);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const signBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
    const signBase64 = btoa(String.fromCharCode(...new Uint8Array(signBuffer)));

    const url = `wss://asr.cloud.tencent.com/asr/v2/${cfg.appId}?${queryStr}&signature=${encodeURIComponent(signBase64)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let finalText = '';
      let resolved = false;

      ws.onopen = () => {
        console.log('[千川看板] ASR WebSocket 已连接');
        resolved = true;
        resolve(ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.code !== 0) {
            onError(`识别错误: ${data.message || data.code}`);
            return;
          }
          const result = data.result;
          if (!result) return;

          const sliceType = result.slice_type;
          const text = result.voice_text_str || '';

          if (sliceType === 2) {
            // 最终结果
            finalText += text;
            onResult(finalText, '');
          } else {
            // 中间结果（0=句首,1=中间）
            onResult(finalText, text);
          }
        } catch (e) {
          console.warn('[千川看板] ASR 消息解析失败:', e);
        }
      };

      ws.onerror = (e) => {
        console.error('[千川看板] ASR WebSocket 错误:', e);
        onError('WebSocket 连接错误');
        if (!resolved) reject(new Error('WebSocket 连接失败'));
      };

      ws.onclose = (e) => {
        console.log('[千川看板] ASR WebSocket 关闭:', e.code, e.reason);
        if (!resolved) reject(new Error('WebSocket 关闭: ' + e.code));
      };
    });
  }

  /**
   * Float32 音频数据转 16bit PCM
   * @param {Float32Array} float32Array
   * @returns {ArrayBuffer}
   */
  function float32ToPCM16(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  /**
   * 下载指定看板的转写文本
   * @param {number} boardId
   * @param {string} boardTitle
   */
  function downloadTranscript(boardId, boardTitle) {
    const item = document.querySelector(`.grid-item[data-id="${boardId}"]`);
    if (!item) return;
    const textEl = item.querySelector('.transcript-text');
    if (!textEl) return;

    // 提取纯文本（final + interim）
    const text = textEl.innerText || textEl.textContent || '';
    if (!text.trim()) {
      alert('暂无转写内容');
      return;
    }

    const filename = `转写_${boardTitle}_${new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[/:]/g, '-')}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 保存看板顺序到 storage
   */
  function saveBoardsOrder() {
    chrome.runtime.sendMessage(
      { action: 'saveBoards', data: { boards } },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[千川助手] 保存顺序失败:', chrome.runtime.lastError);
          return;
        }
        
        if (response && response.success) {
          console.log('[千川助手] 顺序保存成功');
        } else {
          console.error('[千川助手] 保存顺序失败:', response?.error);
        }
      }
    );
  }

})();

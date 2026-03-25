/**
 * 千川多账号直播聚合看板 - Content Script
 * 
 * 功能：
 * 1. 监听 background 消息，执行导航和提取操作
 * 2. 自动导航到直播大屏页面
 * 3. 提取并保存大屏 URL
 * 4. 在 board-next 页面显示浮动保存按钮
 */

(function() {
  'use strict';

  const LOG_PREFIX = '[千川助手]';

  // ============================================
  // 消息监听
  // ============================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action } = message;

    switch (action) {
      case 'startNavigation':
        // 触发自动导航
        console.log(`${LOG_PREFIX} 收到导航指令`);
        autoNavigateToBoard();
        sendResponse({ success: true, message: '导航已启动' });
        return false;

      case 'extractCurrentBoard':
        // 提取当前大屏页面
        console.log(`${LOG_PREFIX} 收到提取指令`);
        if (isBoardPage()) {
          saveCurrentBoard((saveResult) => {
            sendResponse({ status: saveResult && saveResult.success ? 'saved' : 'save_failed', error: saveResult && saveResult.error });
          });
        } else {
          sendResponse({ status: 'not_board_page' });
        }
        return true; // 异步响应

      case 'setupEcpFilters':
        // 设置今天日期 + 整体消耗降序
        console.log(`${LOG_PREFIX} 设置 ECP 筛选条件`);
        setupEcpFilters().then(sendResponse);
        return true; // 异步

      case 'getAccountCount':
        // 返回 ECP 页面当前可见账号数量
        console.log(`${LOG_PREFIX} 获取 ECP 账号数量`);
        sendResponse({ count: getAccountCount() });
        return false;

      case 'clickAccount':
        // 点击第 N 个账号，优先返回 URL 供 background 静默打开
        console.log(`${LOG_PREFIX} 点击第 ${message.index} 个账号`);
        sendResponse(clickAccount(message.index));
        return false;

      case 'checkLiveCampaign':
        // 检查是否有"直播大屏"徽标（不点击）
        sendResponse(checkLiveCampaign());
        return false;

      case 'clickLiveCampaign':
        // 找投放中计划并点击
        console.log(`${LOG_PREFIX} 点击投放中计划`);
        sendResponse(clickLiveCampaign());
        return false;

      case 'clickBoardLink':
        // 找直播大屏并点击
        console.log(`${LOG_PREFIX} 点击直播大屏`);
        sendResponse(clickBoardLink());
        return false;

      case 'clickNextPage':
        // 点击下一页
        console.log(`${LOG_PREFIX} 点击下一页`);
        sendResponse(clickNextPage());
        return false;

      case 'scanAccounts':
        // 扫描 ECP 页面，提取所有千川账号 aavid
        console.log(`${LOG_PREFIX} 扫描 ECP 账号列表`);
        sendResponse({ aavids: scanAccounts() });
        return false;

      case 'scanLiveCampaigns':
        // 扫描计划列表页，提取投放中计划的 adId
        console.log(`${LOG_PREFIX} 扫描投放中计划`);
        sendResponse({ adIds: scanLiveCampaigns() });
        return false;

      case 'extractBoardUrl':
        // 从计划详情页提取直播大屏 URL
        console.log(`${LOG_PREFIX} 提取直播大屏 URL`);
        sendResponse(extractBoardUrl());
        return false;

      default:
        sendResponse({ success: false, error: '未知 action: ' + action });
        return false;
    }
  });

  // ============================================
  // 页面检测工具
  // ============================================

  /**
   * 检测当前是否为大屏页面
   * @returns {boolean}
   */
  function isBoardPage() {
    return window.location.href.includes('board-next');
  }

  /**
   * 检测当前是否为直播列表页
   * @returns {boolean}
   */
  function isLiveListPage() {
    const url = window.location.href;
    return url.includes('/live/list') || url.includes('/live/index');
  }

  /**
   * 检测当前是否为首页
   * @returns {boolean}
   */
  function isIndexPage() {
    const url = window.location.href;
    return url.includes('/index') || url === 'https://qianchuan.jinritemai.com/' || 
           url === 'https://buyin.jinritemai.com/';
  }

  // ============================================
  // 自动导航逻辑
  // ============================================

  /**
   * 自动导航到直播大屏
   * 根据当前页面类型执行不同的导航策略
   */
  function autoNavigateToBoard() {
    console.log(`${LOG_PREFIX} 开始自动导航，当前URL:`, window.location.href);

    try {
      if (isLiveListPage()) {
        console.log(`${LOG_PREFIX} 检测到直播列表页，查找大屏按钮`);
        findAndClickBoardButton();
      } else if (isIndexPage()) {
        console.log(`${LOG_PREFIX} 检测到首页，点击直播菜单`);
        clickLiveMenu();
      } else {
        console.log(`${LOG_PREFIX} 尝试查找直播相关链接`);
        findAndClickLiveLink();
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} 导航失败:`, error);
    }
  }

  /**
   * 点击直播菜单
   * 尝试多种选择器查找"直播"菜单
   */
  function clickLiveMenu() {
    const selectors = [
      '[data-menu-id="live"]',
      'a[href*="/live"]',
      'a[href*="/live/index"]',
      'a[href*="/live/list"]',
      '[class*="menu"] a[href*="live"]',
      'li[data-key="live"]',
      'div[data-key="live"]'
    ];

    // 首先尝试 CSS 选择器
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          console.log(`${LOG_PREFIX} 找到直播菜单(选择器):`, selector);
          element.click();
          console.log(`${LOG_PREFIX} 已点击直播菜单`);
          return;
        }
      } catch (e) {
        // 忽略选择器错误，继续尝试下一个
      }
    }

    // 如果 CSS 选择器没找到，遍历查找包含"直播"文字的菜单
    const allElements = document.querySelectorAll('a, span, div, li');
    const keywords = ['直播管理', '直播间', '直播列表', '我的直播'];

    for (const element of allElements) {
      const text = element.textContent?.trim();
      if (text && keywords.some(keyword => text.includes(keyword))) {
        console.log(`${LOG_PREFIX} 找到直播菜单(文字匹配):`, text);
        element.click();
        console.log(`${LOG_PREFIX} 已点击直播菜单`);
        return;
      }
    }

    // 未找到菜单，提示用户
    console.warn(`${LOG_PREFIX} 未找到直播菜单`);
    alert('未找到直播菜单，请手动点击"直播"菜单进入直播列表页');
  }

  /**
   * 查找并点击大屏按钮
   * 在直播列表页查找"大屏"或"数据大屏"按钮
   */
  function findAndClickBoardButton() {
    // 首先尝试通过文字内容查找
    const keywords = ['大屏', '数据大屏', '直播大屏', '实时大屏'];
    const elements = document.querySelectorAll('button, a, span, div');

    for (const element of elements) {
      const text = element.textContent?.trim();
      if (text && keywords.some(keyword => text.includes(keyword))) {
        console.log(`${LOG_PREFIX} 找到大屏按钮(文字匹配):`, text);
        element.click();
        console.log(`${LOG_PREFIX} 已点击大屏按钮`);
        
        // 设置延时检查是否跳转到大屏页面
        setTimeout(() => {
          if (isBoardPage()) {
            console.log(`${LOG_PREFIX} 成功跳转到大屏页面，自动保存`);
            saveCurrentBoard();
          }
        }, 3000);
        return;
      }
    }

    // 尝试通过 class 查找
    const classSelectors = [
      '[class*="board"]',
      '[class*="screen"]',
      '[class*="dash"]'
    ];

    for (const selector of classSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          console.log(`${LOG_PREFIX} 找到大屏按钮(class):`, selector);
          element.click();
          
          setTimeout(() => {
            if (isBoardPage()) {
              console.log(`${LOG_PREFIX} 成功跳转到大屏页面，自动保存`);
              saveCurrentBoard();
            }
          }, 3000);
          return;
        }
      } catch (e) {
        // 忽略错误
      }
    }

    console.warn(`${LOG_PREFIX} 未找到大屏按钮`);
    alert('未找到大屏按钮，请手动点击"数据大屏"按钮');
  }

  /**
   * 查找并点击直播相关链接
   * 作为兜底方案，查找包含"live"或"board"的链接
   */
  function findAndClickLiveLink() {
    const allLinks = document.querySelectorAll('a');
    
    for (const link of allLinks) {
      const href = link.href || '';
      const text = link.textContent?.trim() || '';
      
      if (href.includes('live') || href.includes('board') ||
          text.includes('直播') || text.includes('大屏')) {
        console.log(`${LOG_PREFIX} 找到直播相关链接:`, text || href);
        link.click();
        return;
      }
    }

    console.warn(`${LOG_PREFIX} 未找到直播相关链接`);
    alert('未找到直播入口，请手动导航到直播列表页');
  }

  // ============================================
  // 保存功能
  // ============================================

  /**
   * 保存当前大屏页面到看板
   * @param {Function} [callback] - 可选回调，接收 background 返回的 response
   */
  function saveCurrentBoard(callback) {
    if (!isBoardPage()) {
      console.warn(`${LOG_PREFIX} 当前不是大屏页面，无法保存`);
      if (callback) callback(null);
      return;
    }

    const url = window.location.href;
    const title = document.title || '未命名看板';

    console.log(`${LOG_PREFIX} 准备保存看板:`, { url, title });

    // 发送消息给 background 保存
    chrome.runtime.sendMessage({
      action: 'saveBoardUrl',
      data: { url, title }
    }, (response) => {
      if (response && response.success) {
        console.log(`${LOG_PREFIX} 看板保存成功，当前数量:`, response.count);
        showToast('已保存到看板', 'success');
      } else {
        const errorMsg = response?.error || '保存失败';
        console.warn(`${LOG_PREFIX} 保存失败:`, errorMsg);
        showToast(errorMsg, 'error');
      }
      if (callback) callback(response);
    });
  }

  // ============================================
  // 浮动按钮
  // ============================================

  /**
   * 显示保存浮动按钮
   * 仅在 board-next 页面显示
   */
  function showSaveFloatingButton() {
    if (!isBoardPage()) {
      return;
    }

    // 检查是否已存在按钮
    if (document.getElementById('qianchuan-save-btn')) {
      return;
    }

    console.log(`${LOG_PREFIX} 显示浮动保存按钮`);

    // 创建按钮容器
    const button = document.createElement('button');
    button.id = 'qianchuan-save-btn';
    button.innerHTML = '📊 保存到大屏看板';
    
    // 设置样式
    button.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background-color: #ff0050;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(255, 0, 80, 0.3);
      z-index: 99999;
      transition: all 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    // 悬停效果
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.05)';
      button.style.boxShadow = '0 6px 16px rgba(255, 0, 80, 0.4)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 4px 12px rgba(255, 0, 80, 0.3)';
    });

    // 点击事件
    button.addEventListener('click', () => {
      saveCurrentBoard();
      
      // 更新按钮状态为已保存
      button.innerHTML = '✅ 已保存';
      button.style.backgroundColor = '#52c41a';
      button.style.boxShadow = '0 4px 12px rgba(82, 196, 26, 0.3)';
      button.style.cursor = 'default';
      button.disabled = true;

      // 2秒后移除按钮
      setTimeout(() => {
        if (button.parentNode) {
          button.remove();
        }
      }, 2000);
    });

    // 添加到页面
    document.body.appendChild(button);
    console.log(`${LOG_PREFIX} 浮动按钮已添加到页面`);
  }

  // ============================================
  // 提示工具
  // ============================================

  /**
   * 显示临时提示
   * @param {string} message - 提示内容
   * @param {string} type - 类型: 'success' | 'error'
   */
  function showToast(message, type = 'success') {
    // 移除已存在的提示
    const existingToast = document.getElementById('qianchuan-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // 创建提示元素
    const toast = document.createElement('div');
    toast.id = 'qianchuan-toast';
    
    const bgColor = type === 'success' ? '#52c41a' : '#ff4d4f';
    
    toast.style.cssText = `
      position: fixed;
      top: 140px;
      right: 20px;
      background-color: ${bgColor};
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      z-index: 99999;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: qianchuan-toast-in 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    toast.textContent = message;

    // 添加动画样式
    if (!document.getElementById('qianchuan-toast-style')) {
      const style = document.createElement('style');
      style.id = 'qianchuan-toast-style';
      style.textContent = `
        @keyframes qianchuan-toast-in {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // 3秒后自动移除
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.animation = 'qianchuan-toast-in 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
      }
    }, 3000);
  }

  // ============================================
  // 初始化
  // ============================================

  /**
   * 页面加载完成后初始化
   */
  function init() {
    console.log(`${LOG_PREFIX} Content Script 已加载，当前URL:`, window.location.href);

    // 延时检查是否为大屏页面，显示浮动按钮
    setTimeout(() => {
      if (isBoardPage()) {
        console.log(`${LOG_PREFIX} 检测到大屏页面，显示浮动按钮`);
        showSaveFloatingButton();
      }
    }, 2000);

    // 监听 URL 变化（单页应用路由变化）
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        console.log(`${LOG_PREFIX} URL 变化:`, currentUrl);
        lastUrl = currentUrl;
        
        // URL 变化后检查是否为大屏页面
        if (isBoardPage()) {
          setTimeout(() => {
            showSaveFloatingButton();
          }, 1000);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // 执行初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================
  // 自动采集：点击操作函数（模拟人工操作）
  // ============================================

  /**
   * 获取 ECP 账号行内的账号名链接列表
   * 账号名是 td/div 内的 <a> 标签，href 含 account 或 aavid，或者直接找含 ID: 数字 的行内第一个 <a>
   * @returns {Element[]}
   */
  function getAccountNameLinks() {
    // 找所有含 "ID：" 或 "ID:" 字样的行（账号信息列），取该行内第一个 <a>
    const idPattern = /ID[：:]\s*\d{8,20}/;
    const links = [];
    // 遍历表格行
    for (const row of document.querySelectorAll('tr')) {
      if (idPattern.test(row.textContent)) {
        const link = row.querySelector('a, [class*="name"], [class*="account"]');
        if (link) links.push(link);
      }
    }
    // 兜底：找不到 tr，改找 div 行
    if (links.length === 0) {
      for (const el of document.querySelectorAll('div, li')) {
        if (el.children.length <= 3 && idPattern.test(el.textContent)) {
          const link = el.querySelector('a') || el;
          links.push(link);
        }
      }
    }
    return links;
  }

  /**
   * 获取 ECP 页面当前可见账号数量
   * @returns {number}
   */
  function getAccountCount() {
    const links = getAccountNameLinks();
    console.log(`${LOG_PREFIX} getAccountCount: 找到 ${links.length} 个账号`);
    return links.length;
  }

  /**
   * 点击第 index 个账号名
   * @param {number} index
   */
  function clickAccount(index) {
    const links = getAccountNameLinks();
    if (links.length <= index) {
      console.warn(`${LOG_PREFIX} clickAccount(${index}): 未找到账号`);
      return { success: false, url: null };
    }
    const link = links[index];

    // 优先：href 直接包含 uni-prom
    if (link.href && link.href.includes('uni-prom')) {
      return { success: true, url: link.href };
    }

    // 从行文本提取 aavid，构造 URL（不触发任何 click）
    const idPattern = /ID[：:]\s*(\d{8,20})/;
    let container = link.parentElement;
    for (let d = 0; d < 10 && container && container !== document.body; d++) {
      if (container.textContent.length < 600) {
        const m = container.textContent.match(idPattern);
        if (m) {
          const url = `https://qianchuan.jinritemai.com/uni-prom?aavid=${m[1]}`;
          console.log(`${LOG_PREFIX} clickAccount(${index}): 构造 URL aavid=${m[1]}`);
          return { success: true, url };
        }
      }
      container = container.parentElement;
    }

    // 兜底：点击（会引起页面跳转）
    console.log(`${LOG_PREFIX} clickAccount(${index}): 兜底 click`);
    link.click();
    return { success: true, url: null };
  }

  /**
   * 关闭页面上的弹窗（找 × 关闭按钮点击）
   */
  function closePopup() {
    // 找所有叶节点，文字为 × 或 ✕ 的按钮/span
    for (const el of document.querySelectorAll('button, span, i, svg')) {
      if (el.children.length === 0) {
        const text = el.textContent.trim();
        const label = el.getAttribute('aria-label') || '';
        if (text === '×' || text === '✕' || text === '✖' || label === '关闭' || label === 'Close') {
          console.log(`${LOG_PREFIX} closePopup: 关闭弹窗`);
          el.click();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 在计划列表页找"投放中"行并点击计划名链接进入详情（同标签跳转）
   * @returns {{ found: boolean }}
   */
  /**
   * 找到"投放中"所在行，返回该行内"直播大屏"徽标元素（不点击）
   * @returns {Element|null}
   */
  /**
   * 判断元素的"显示文本"是否等于目标字符串
   * strict=true：要求 innerHTML < 300（用于找"直播大屏"徽标，避免匹配大容器）
   * strict=false：只比对 textContent（用于找"投放中"状态，允许内部有 SVG 图标）
   */
  function textIs(el, target, strict = true) {
    const t = el.textContent.trim();
    if (t !== target) return false;
    if (strict) return el.innerHTML.length < 300;
    return true;
  }

  function findBadgeInActiveRow() {
    // 策略1：从"投放中"节点向上找行容器（TR / role=row / role=listitem），再向下找"直播大屏"
    for (const el of document.querySelectorAll('*')) {
      if (textIs(el, '投放中', false)) {
        let container = el.parentElement;
        for (let d = 0; d < 15 && container && container !== document.body; d++) {
          const role = container.getAttribute && container.getAttribute('role');
          if (container.tagName === 'TR' || role === 'row' || role === 'listitem') {
            for (const child of container.querySelectorAll('*')) {
              if (child !== el && textIs(child, '直播大屏')) {
                return child;
              }
            }
            break; // 行容器内无徽标，不继续向上
          }
          container = container.parentElement;
        }
      }
    }

    // 策略2（兜底）：最小公共祖先——从"投放中"节点逐级向上，第一次包含"直播大屏"的祖先即行容器
    for (const el of document.querySelectorAll('*')) {
      if (textIs(el, '投放中', false)) {
        let container = el.parentElement;
        for (let d = 0; d < 20 && container && container !== document.body; d++) {
          for (const child of container.querySelectorAll('*')) {
            if (child !== el && textIs(child, '直播大屏')) {
              return child;
            }
          }
          container = container.parentElement;
        }
      }
    }

    return null;
  }

  function checkLiveCampaign() {
    const badge = findBadgeInActiveRow();
    let statusCount = 0;
    // 收集页面上所有"状态类"短文本（2-6个字的叶节点），用于诊断
    const statusTexts = new Set();
    document.querySelectorAll('*').forEach(el => {
      const t = el.textContent.trim();
      if (t === '投放中') statusCount++;  // 不限 innerHTML 长度
      // 收集常见状态类关键词（宽松，不限 children）
      if (t.length >= 2 && t.length <= 8 && el.innerHTML.length < 200 &&
          /[投放暂停启用审核中止学习]/.test(t)) {
        statusTexts.add(t);
      }
    });
    // 收集页面上找到的"直播大屏"元素数量（任意位置）
    let anyBadgeCount = 0;
    document.querySelectorAll('*').forEach(el => {
      if (textIs(el, '直播大屏')) anyBadgeCount++;
    });
    return {
      badgeCount: badge ? 1 : 0,
      statusCount,
      anyBadgeCount,
      statusTexts: [...statusTexts].slice(0, 10)
    };
  }

  function clickLiveCampaign() {
    const badge = findBadgeInActiveRow();
    if (!badge) {
      console.log(`${LOG_PREFIX} clickLiveCampaign: 未找到"投放中"行内的"直播大屏"徽标`);
      return { found: false };
    }

    // 策略1：向上找最近的 <a href> 祖先
    let node = badge;
    for (let d = 0; d < 10 && node && node !== document.body; d++) {
      if (node.tagName === 'A' && node.href && node.href.includes('board-next')) {
        return { found: true, url: node.href };
      }
      node = node.parentElement;
    }

    // 策略2：扫描"投放中"行内所有 <a href> 含 board-next
    const row = badge.closest('tr, [role="row"], [role="listitem"]') || badge.parentElement;
    if (row) {
      for (const a of row.querySelectorAll('a[href]')) {
        if (a.href && a.href.includes('board-next')) {
          return { found: true, url: a.href };
        }
      }
    }

    // 策略3：扫描全页所有 <a href> 含 board-next（页面可能用 JS 渲染了隐藏链接）
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.href && a.href.includes('board-next') && a.href.includes('live_room_id')) {
        return { found: true, url: a.href };
      }
    }

    // 策略4：检查徽标及其祖先的 data-* 属性
    let node4 = badge;
    for (let d = 0; d < 8 && node4 && node4 !== document.body; d++) {
      for (const attr of node4.attributes || []) {
        if (attr.value && attr.value.includes('board-next') && attr.value.includes('live_room_id')) {
          return { found: true, url: attr.value.replace(/&amp;/g, '&') };
        }
      }
      // React props（__reactProps$xxx）
      const rKey = Object.keys(node4).find(k => k.startsWith('__reactProps'));
      if (rKey) {
        try {
          const ps = JSON.stringify(node4[rKey]);
          const rm = ps && ps.match(/https?:\\?\/\\?\/[^"\\]*board-next[^"\\]*live_room_id=[^"\\]+/);
          if (rm) return { found: true, url: rm[0].replace(/\\\/\//g, '//').replace(/\\\//g, '/').replace(/&amp;/g, '&') };
        } catch(e) {}
      }
      node4 = node4.parentElement;
    }

    // 策略5：全页 HTML 正则（board-next + live_room_id）
    const htmlMatch = document.documentElement.innerHTML.match(
      /https?:\/\/[^"'<>\s\\]*board-next[^"'<>\s\\]*live_room_id=[^"'<>\s\\&]+[^"'<>\s\\]*/
    );
    if (htmlMatch) {
      const url = htmlMatch[0].replace(/&amp;/g, '&');
      console.log(`${LOG_PREFIX} clickLiveCampaign: HTML 扫描到 URL`);
      return { found: true, url };
    }

    // 策略6：兜底点击（最后手段，会引起页面闪烁）
    console.log(`${LOG_PREFIX} clickLiveCampaign: 所有提取方式失败，fallback 点击`);
    badge.click();
    return { found: true, url: null };
  }

  /**
   * 在计划详情页找"直播大屏"并点击（新开标签）
   * @returns {{ found: boolean }}
   */
  function clickBoardLink() {
    // 先关弹窗
    closePopup();

    // 找文字含"直播大屏"的任意叶节点
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length === 0 && el.textContent.trim().includes('直播大屏')) {
        console.log(`${LOG_PREFIX} clickBoardLink: 找到并点击 (文字匹配)`);
        el.click();
        return { found: true };
      }
    }
    // 兜底：href 含 board-next 的 <a>
    const boardLink = document.querySelector('a[href*="board-next"]');
    if (boardLink) {
      console.log(`${LOG_PREFIX} clickBoardLink: 找到并点击 (board-next href)`);
      boardLink.click();
      return { found: true };
    }
    console.log(`${LOG_PREFIX} clickBoardLink: 未找到直播大屏`);
    return { found: false };
  }

  /**
   * 点击下一页按钮
   * @returns {{ found: boolean }}
   */
  function clickNextPage() {
    // CSS 选择器（排除 disabled 状态）
    const nextSelectors = [
      '[class*="next"]:not([disabled])',
      '[aria-label="Next"]:not([disabled])',
      '[aria-label="下一页"]:not([disabled])',
    ];
    for (const sel of nextSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && !el.disabled && !el.classList.contains('disabled')) {
          console.log(`${LOG_PREFIX} clickNextPage: 找到并点击 (${sel})`);
          el.click();
          return { found: true };
        }
      } catch (e) { /* 忽略选择器错误 */ }
    }
    // 文字匹配
    for (const el of document.querySelectorAll('button, a, li, span')) {
      const text = el.textContent.trim();
      if ((text === '下一页' || text === '>') && !el.disabled && !el.classList.contains('disabled')) {
        console.log(`${LOG_PREFIX} clickNextPage: 找到并点击 (文字: ${text})`);
        el.click();
        return { found: true };
      }
    }
    console.log(`${LOG_PREFIX} clickNextPage: 未找到下一页按钮`);
    return { found: false };
  }

  /**
   * ECP 页面初始化：选今天日期 + 点击整体消耗降序
   * @returns {Promise<{ success: boolean }>}
   */
  async function setupEcpFilters() {
    // --- 第一步：点击日期选择器，选"今天" ---
    let dateSet = false;

    // 尝试找日期快捷选项"今天"
    const allClickable = document.querySelectorAll('button, span, div, li, a');
    for (const el of allClickable) {
      const text = el.textContent.trim();
      if (text === '今天' && el.children.length === 0) {
        console.log(`${LOG_PREFIX} setupEcpFilters: 找到"今天"快捷项，点击`);
        el.click();
        dateSet = true;
        break;
      }
    }

    // 如果没有直接可见的"今天"，先打开日期选择器再找
    if (!dateSet) {
      const datePickerTriggers = [
        '[class*="date-picker"]',
        '[class*="datePicker"]',
        '[class*="date_picker"]',
        '[class*="range-picker"]',
        '[class*="RangePicker"]',
      ];
      for (const sel of datePickerTriggers) {
        const trigger = document.querySelector(sel);
        if (trigger) {
          trigger.click();
          await new Promise(r => setTimeout(r, 500));
          // 再找"今天"
          for (const el of document.querySelectorAll('button, span, div, li, td')) {
            if (el.textContent.trim() === '今天' && el.children.length === 0) {
              el.click();
              dateSet = true;
              break;
            }
          }
          if (dateSet) break;
        }
      }
    }

    console.log(`${LOG_PREFIX} setupEcpFilters: 日期设置${dateSet ? '成功' : '失败（未找到今天选项）'}`);

    // 等待列表刷新
    await new Promise(r => setTimeout(r, 1500));

    // --- 第二步：点击"整体消耗"列头，确保降序 ---
    let sortSet = false;
    const keywords = ['整体消耗', '总消耗', '消耗'];
    const headers = document.querySelectorAll('th, [class*="header"], [class*="Header"], [class*="column-title"], [class*="col-title"]');

    for (const header of headers) {
      const text = header.textContent.trim();
      if (keywords.some(k => text.includes(k))) {
        console.log(`${LOG_PREFIX} setupEcpFilters: 找到消耗列头"${text}"，点击降序`);
        header.click();
        await new Promise(r => setTimeout(r, 600));
        // 若当前是升序，再点一次变降序
        const sortIcon = header.querySelector('[class*="desc"], [class*="down"], [aria-sort="descending"]');
        if (!sortIcon) {
          // 检查 aria-sort 属性或 class 是否已是降序
          const ariaSort = header.getAttribute('aria-sort');
          if (ariaSort !== 'descending') {
            header.click();
            await new Promise(r => setTimeout(r, 600));
          }
        }
        sortSet = true;
        break;
      }
    }

    // 兜底：从所有文字节点中找
    if (!sortSet) {
      for (const el of document.querySelectorAll('*')) {
        const text = el.textContent.trim();
        if (el.children.length <= 2 && keywords.some(k => text === k)) {
          el.click();
          await new Promise(r => setTimeout(r, 600));
          el.click(); // 第二次确保降序
          sortSet = true;
          break;
        }
      }
    }

    console.log(`${LOG_PREFIX} setupEcpFilters: 排序设置${sortSet ? '成功' : '失败（未找到消耗列头）'}`);

    // 等待排序后列表稳定
    await new Promise(r => setTimeout(r, 1500));

    return { success: true, dateSet, sortSet };
  }

  // ============================================
  // 自动采集：扫描函数
  // ============================================

  /**
   * 扫描 ECP 多账号管理页，提取所有千川账号 aavid
   * @returns {string[]}
   */
  function scanAccounts() {
    const aavids = new Set();

    // 策略一：从链接 href 中提取 aavid 参数
    const hrefPattern = /[?&]aavid=(\d+)/;
    document.querySelectorAll('a[href]').forEach(link => {
      const match = link.href && link.href.match(hrefPattern);
      if (match) aavids.add(match[1]);
    });

    // 策略二：从页面文字中提取 "ID: 数字" 格式（始终执行，不再作为兜底）
    const textPattern = /(?:账号ID|广告主ID|ID)[：:]\s*(\d{8,20})/g;
    const bodyText = document.body.innerText || '';
    let match;
    while ((match = textPattern.exec(bodyText)) !== null) {
      aavids.add(match[1]);
    }

    // 策略三：从页面 HTML（含 script 标签内嵌 JSON）中提取 aavid 字段
    // 覆盖虚拟列表只渲染部分账号的场景
    const jsonPattern = /["']aavid["']\s*:\s*["']?(\d+)["']?/g;
    const htmlContent = document.documentElement.innerHTML;
    let jsonMatch;
    while ((jsonMatch = jsonPattern.exec(htmlContent)) !== null) {
      aavids.add(jsonMatch[1]);
    }

    // 策略四：从 data 属性中提取
    document.querySelectorAll('[data-aavid],[data-account-id]').forEach(el => {
      const id = el.dataset.aavid || el.dataset.accountId;
      if (id && /^\d{8,20}$/.test(id)) aavids.add(id);
    });

    console.log(`${LOG_PREFIX} 扫描到 aavid（共 ${aavids.size} 个）:`, [...aavids]);
    return [...aavids];
  }

  /**
   * 扫描计划列表页，提取"投放中"计划的 adId
   * @returns {string[]}
   */
  function scanLiveCampaigns() {
    const adIds = new Set();
    const adIdFromHref = /[?&]adId=(\d+)/;
    const adIdFromText = /\badId["']?\s*[=:]\s*["']?(\d{10,20})/;

    // 找所有含"投放中"文字的叶子/浅层节点
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent.trim();
      if (el.children.length <= 2 && text.includes('投放中') && text.length < 30) {
        // 向上最多 15 层找行容器，分别尝试多种 adId 来源
        let row = el.parentElement;
        for (let depth = 0; depth < 15 && row; depth++) {

          // 来源1：<a href="...adId=xxx...">
          row.querySelectorAll('a[href]').forEach(link => {
            const m = link.href && link.href.match(adIdFromHref);
            if (m) adIds.add(m[1]);
          });

          // 来源2：data-ad-id / data-adid / data-id 属性
          row.querySelectorAll('[data-ad-id],[data-adid],[data-id]').forEach(dataEl => {
            const id = dataEl.dataset.adId || dataEl.dataset.adid || dataEl.dataset.id;
            if (id && /^\d{10,20}$/.test(id)) adIds.add(id);
          });

          // 来源3：行容器整体 outerHTML 内含 adId 字符串（应对 JS 路由 / 埋在 JSON 里）
          const rowHtml = row.outerHTML;
          if (rowHtml.length < 50000) { // 避免处理超大 HTML
            const m2 = rowHtml.match(adIdFromText);
            if (m2) adIds.add(m2[1]);
          }

          if (adIds.size > 0) break;
          row = row.parentElement;
        }
      }
    }

    // 兜底：找所有 <a href> 含 adId=，祖先含"投放中"
    if (adIds.size === 0) {
      document.querySelectorAll('a[href]').forEach(link => {
        const m = link.href && link.href.match(adIdFromHref);
        if (m) {
          let parent = link.parentElement;
          for (let depth = 0; depth < 8 && parent; depth++) {
            if (parent.textContent.includes('投放中')) {
              adIds.add(m[1]);
              break;
            }
            parent = parent.parentElement;
          }
        }
      });
    }

    console.log(`${LOG_PREFIX} 扫描到投放中 adId（共 ${adIds.size} 个）:`, [...adIds]);
    return [...adIds];
  }

  /**
   * 从计划详情页提取直播大屏 URL
   * @returns {{ url: string|null, title: string|null }}
   */
  function extractBoardUrl() {
    // 策略一：找文字含"直播大屏"的 <a> 标签
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
      const text = link.textContent.trim();
      if (text.includes('直播大屏') && link.href && link.href.includes('board-next') && link.href.includes('live_room_id=')) {
        console.log(`${LOG_PREFIX} 找到直播大屏链接(文字匹配):`, link.href);
        return { url: link.href, title: null };
      }
    }

    // 策略二：放宽条件，只要含 board-next 即可（去掉 live_room_id= 要求）
    for (const link of allLinks) {
      if (link.href && link.href.includes('board-next')) {
        console.log(`${LOG_PREFIX} 找到直播大屏链接(board-next匹配):`, link.href);
        return { url: link.href, title: null };
      }
    }

    // 策略三：扫描页面 HTML，找 board-next URL（应对 JS 路由生成的链接）
    const pageHtml = document.documentElement.innerHTML;
    const boardUrlMatch = pageHtml.match(/https?:\/\/[^"'\s]+board-next[^"'\s]*live_room_id=[^"'\s]+/);
    if (boardUrlMatch) {
      const url = boardUrlMatch[0].replace(/&amp;/g, '&');
      console.log(`${LOG_PREFIX} 找到直播大屏链接(HTML扫描):`, url);
      return { url, title: null };
    }

    console.log(`${LOG_PREFIX} 未找到直播大屏链接`);
    return { url: null, title: null };
  }

})();

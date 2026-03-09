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
          saveCurrentBoard();
          sendResponse({ status: 'saved' });
        } else {
          sendResponse({ status: 'not_board_page' });
        }
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
   */
  function saveCurrentBoard() {
    if (!isBoardPage()) {
      console.warn(`${LOG_PREFIX} 当前不是大屏页面，无法保存`);
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

})();

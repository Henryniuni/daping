/**
 * 在页面 JS 执行前覆盖 iframe 检测属性
 * 让页面误以为自己不在 iframe 中
 */
try {
  Object.defineProperty(window, 'top',         { get: () => window,   configurable: true });
  Object.defineProperty(window, 'parent',      { get: () => window,   configurable: true });
  Object.defineProperty(window, 'frameElement',{ get: () => null,     configurable: true });
} catch(e) {}

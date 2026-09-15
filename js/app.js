/* ===== app.js =====
   入口：装配路由、绑定导出/导入等全局操作 */

'use strict';

function App_init() {
  // 侧栏开关（桌面）由 router 统一处理

  // 外观双态（REQ-010）：light=浅色 / dark=深色，日蚀式开关
  const mode0 = (Controller.getSettings().theme === 'dark') ? 'dark' : 'light';
  const desktopSlot = document.getElementById('themeToggleDesktop');
  if (desktopSlot) desktopSlot.innerHTML = UI.themeToggleHTML(mode0, 'lg');
  UI.applyTheme(mode0);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme-toggle]');
    if (!t) return;
    const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    t.classList.add('switching');
    setTimeout(() => t.classList.remove('switching'), 460);
    Controller.updateSettings({ theme: next });
    UI.applyTheme(next);
    Toast.show(`已切换为${next === 'dark' ? '深色' : '浅色'}外观`);
  });

  // 导出
  document.getElementById('btnExport').onclick = () => Controller.exportAll();

  // 导入
  const importInput = document.getElementById('fileImport');
  document.getElementById('btnImport').onclick = () => importInput.click();
  importInput.onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    await Controller.importAll(text);
    importInput.value = '';
    Router.navigate('dashboard'); // 导入后回到首页刷新
  };

  Router.init();
}

document.addEventListener('DOMContentLoaded', App_init);
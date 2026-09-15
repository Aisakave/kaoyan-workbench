/* ===== router.js =====
   视图切换（hash 无刷新路由）+ 侧栏/底部Tab渲染 + 顶部标题与倒计时 */

'use strict';

const Router = (() => {
  const ROUTES = [
    { id: 'dashboard',   ico: 'home',     label: '首页' },
    { id: 'plan',        ico: 'calendar', label: '学习计划' },
    { id: 'subject',     ico: 'book',     label: '科目进度' },
    { id: 'pastPaper',   ico: 'file',     label: '真题管理' },
    { id: 'mockExam',    ico: 'trophy',   label: '模考成绩' },
    { id: 'wrong',       ico: 'pencil',   label: '错题簿' },
    { id: 'material',    ico: 'folder',   label: '资料库' },
    { id: 'stats',       ico: 'chart',    label: '数据' }
  ];
  const VIEWS = {
    dashboard: DashboardView,
    plan: PlanView,
    subject: SubjectView,
    pastPaper: PastPaperView,
    mockExam: MockExamView,
    wrong: WrongBookView,
    material: MaterialView,
    stats: StatsView
  };

  let current = 'dashboard';

  function currentId() { return current; }

  // 手机底部精选 Tab 与「更多」面板项
  const TAB_PRIMARY = ['dashboard', 'plan', 'wrong', 'material', 'stats'];
  const TAB_MORE    = ['subject', 'pastPaper', 'mockExam'];
  function route(id) { return ROUTES.find(x => x.id === id); }
  function currentTheme() { return Controller.getSettings().theme === 'dark' ? 'dark' : 'light'; }

  // ---- 侧栏开合 + 蒙层（点击蒙层关闭）----
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    const m = document.getElementById('sidebarMask');
    if (m) { m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    const m = document.getElementById('sidebarMask');
    if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
  }
  function toggleSidebar() {
    document.getElementById('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
  }

  // ---- 「更多」底部面板开合 ----
  function openSheet() {
    const s = document.getElementById('tabSheet');
    if (s) { s.classList.add('open'); s.setAttribute('aria-hidden', 'false'); }
  }
  function closeSheet() {
    const s = document.getElementById('tabSheet');
    if (s) { s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); }
  }

  function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return VIEWS[h] ? h : 'dashboard';
  }

  function navigate(id) {
    if (!VIEWS[id]) id = 'dashboard';
    location.hash = '/' + id;
  }

  function renderNav() {
    const sideNav = document.getElementById('sideNav');
    sideNav.innerHTML = ROUTES.map(r =>
      `<button class="nav-item ${r.id === current ? 'active' : ''}" data-route="${r.id}">
        <span class="nav-ico">${UI.icon(r.ico, 20)}</span>${r.label}
        ${r.id === 'wrong' ? '<span class="nav-badge" data-badge-for="wrong"></span>' : ''}</button>`).join('');

    const tabBar = document.getElementById('tabBar');
    const tabItemHTML = (id, isMore = false) => {
      const r = isMore ? { id: 'more', ico: 'more', label: '更多' } : route(id);
      const active = isMore ? TAB_MORE.includes(current) : (r.id === current);
      return `<button class="tab-item ${active ? 'active' : ''} ${isMore ? 'tab-more' : ''}"
                ${isMore ? 'data-more' : `data-route="${r.id}"`}>
        <span class="tab-ico">${UI.icon(r.ico, 20)}</span>${r.label}
        ${r.id === 'wrong' ? '<span class="tab-badge" data-badge-for="wrong"></span>' : ''}</button>`;
    };
    tabBar.innerHTML = TAB_PRIMARY.map(id => tabItemHTML(id)).join('')
      + tabItemHTML('more', true);

    renderTabSheet();

    document.getElementById('pageTitle').textContent =
      (ROUTES.find(r => r.id === current) || {}).label || '';
    UI.applyTheme(currentTheme()); // 重绘后重新对齐双端开关状态
    refreshBadges();
  }

  // 「更多」底部面板：收纳 3 个次要路由 + 外观开关
  function renderTabSheet() {
    const sheet = document.getElementById('tabSheet');
    if (!sheet) return;
    const items = TAB_MORE.map(id => {
      const r = route(id);
      return `<button class="sheet-item ${r.id === current ? 'active' : ''}" data-route="${r.id}">
        <span class="sheet-ico">${UI.icon(r.ico, 20)}</span>${r.label}
        <span class="sheet-arrow">${UI.icon('more', 16)}</span></button>`;
    }).join('');
    sheet.innerHTML = `
      <div class="tab-sheet-mask" data-sheet-close></div>
      <div class="tab-sheet-panel">
        <div class="tab-sheet-grip"></div>
        <div class="tab-sheet-title">更多功能</div>
        <div class="tab-sheet-list">${items}</div>
        <div class="tab-sheet-theme">
          <span class="sheet-label">外观</span>
          ${UI.themeToggleHTML(currentTheme(), 'lg')}
        </div>
      </div>`;
  }

  // 错题簿红点徽标：显示到期未复习数（0 隐藏，>99 显示 99+）
  function refreshBadges() {
    const n = Controller.reviewDueCount();
    document.querySelectorAll('[data-badge-for="wrong"]').forEach(el => {
      el.textContent = n > 99 ? '99+' : n;
      el.classList.toggle('show', n > 0);
    });
  }

  function render() {
    current = parseHash();
    renderNav();
    const content = document.getElementById('content');
    // 关键：每次创建新的视图容器并整体替换，旧的监听器随节点销毁，避免事件累积
    const holder = document.createElement('div');
    holder.className = 'view-holder';
    holder.id = 'viewHolder';
    content.innerHTML = '';
    content.appendChild(holder);
    const view = VIEWS[current];
    if (view && view.mount) view.mount(holder);
    window.scrollTo(0, 0);
  }

  function refreshTopbar() {
    const s = Controller.getSettings();
    const days = daysUntil(s.examDate);
    const el = document.getElementById('topCountdown');
    if (el) el.innerHTML = days === null ? '' : (days > 0 ? `${UI.icon('clock', 14)} ${days} 天` : '已开考');
  }

  function init() {
    // 侧栏 + Tab 导航事件
    document.addEventListener('click', e => {
      // 点击徽标直达待复习标签
      const badge = e.target.closest('[data-badge-for="wrong"]');
      if (badge) { location.hash = '/wrong?tab=review'; closeSheet(); return; }
      // 路由项（侧栏 / 底部Tab / 更多面板内）
      const item = e.target.closest('[data-route]');
      if (item) { navigate(item.getAttribute('data-route')); closeSheet(); }
      // 侧栏开合（手机）：折叠按钮 或 蒙层点击关闭
      const toggle = e.target.closest('#btnToggleSide');
      if (toggle) { toggleSidebar(); return; }
      if (e.target.closest('#sidebarMask')) { closeSidebar(); return; }
      // 更多底部面板
      if (e.target.closest('[data-more]')) { openSheet(); return; }
      if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
      // 点击底部 Tab 或主区关闭侧栏
      if (e.target.closest('.tab-item') || e.target.closest('.tabbar') || e.target.closest('.main')) {
        closeSidebar();
      }
    });

    window.addEventListener('hashchange', render);
    Controller.on('change', () => { refreshTopbar(); refreshBadges(); });

    render();
    refreshTopbar();
  }

  return { init, navigate, currentId, refreshTopbar, refreshBadges };
})();
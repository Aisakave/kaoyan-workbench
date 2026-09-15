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
    const tMode = (Controller.getSettings().theme === 'dark') ? 'dark' : 'light';
    tabBar.innerHTML = ROUTES.map(r =>
      `<button class="tab-item ${r.id === current ? 'active' : ''}" data-route="${r.id}">
        <span class="tab-ico">${UI.icon(r.ico, 20)}</span>${r.label}
        ${r.id === 'wrong' ? '<span class="tab-badge" data-badge-for="wrong"></span>' : ''}</button>`
    ).join('') + `<span class="tab-theme">${UI.themeToggleHTML(tMode, 'sm')}</span>`;

    document.getElementById('pageTitle').textContent =
      (ROUTES.find(r => r.id === current) || {}).label || '';
    UI.applyTheme(tMode); // 重绘后重新对齐双端开关状态
    refreshBadges();
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
      if (badge) { location.hash = '/wrong?tab=review'; return; }
      const item = e.target.closest('[data-route]');
      if (item) navigate(item.getAttribute('data-route'));
      // 侧栏开合（手机）
      const toggle = e.target.closest('#btnToggleSide');
      if (toggle) document.getElementById('sidebar').classList.toggle('open');
      // 点击主区关侧栏（手机）
      if (e.target.closest('.tab-item') || e.target.closest('.tabbar')) {
        document.getElementById('sidebar').classList.remove('open');
      }
    });

    window.addEventListener('hashchange', render);
    Controller.on('change', () => { refreshTopbar(); refreshBadges(); });

    render();
    refreshTopbar();
  }

  return { init, navigate, currentId, refreshTopbar, refreshBadges };
})();
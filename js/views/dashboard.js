/* ===== views/dashboard.js =====
   首页概览 F-01：倒计时/目标卡/今日任务/学习时长/本周完成率/四科进度 */

'use strict';

const DashboardView = (() => {
  let el;
  let animated = false; // 数字滚动/满格轻弹只首次入场播一次，重渲染不重复（REQ-010）

  function mount(container) {
    el = container;
    container.addEventListener('click', onClick);
    container.addEventListener('change', onChange);
    render();
    animateIn();
  }

  // 首次入场：统计数字增长动画 + 满格进度条轻弹
  function animateIn() {
    if (animated) return;
    requestAnimationFrame(() => {
      el.querySelectorAll('[data-count]').forEach(n => UI.animateCounts(n));
      el.querySelectorAll('.progress > i').forEach(bar => {
        if (parseFloat(bar.style.width || '0') >= 100) bar.classList.add('is-full');
      });
      animated = true;
    });
  }

  function onClick(e) {
    // 今日任务勾选
    const t = e.target.closest('[data-todo]');
    if (t) { Controller.toggleTask(t.getAttribute('data-todo')); render(); return; }
    // 目标设置入口
    if (e.target.closest('[data-open-settings]')) openSettings();
    // 学习时长填写
    if (e.target.closest('[data-log-study]')) openStudyLog();
    // 跳转学习计划
    if (e.target.closest('[data-goto-plan]')) { Router.navigate('plan'); return; }
    if (e.target.closest('[data-goto-wrong]')) { Router.navigate('wrong'); return; }
  }
  function onChange() {}

  function openSettings() {
    const s = Controller.getSettings();
    UI.openModal(UI.modalShell('目标设置', `
      <div class="field"><label>目标院校</label>
        <input id="set-school" class="input" placeholder="例：清华大学" value="${esc(s.school)}"></div>
      <div class="field"><label>目标分数</label>
        <input id="set-score" class="input" type="number" min="0" max="500" placeholder="例：380" value="${s.targetScore === null ? '' : s.targetScore}"></div>
      <div class="field"><label>考试日期</label>
        <input id="set-exam" class="input" type="date" value="${esc(s.examDate)}"></div>
      <div class="field"><label>每日复习目标（道/天，0=不设置）</label>
        <input id="set-rgoal" class="input" type="number" min="0" max="999" placeholder="0" value="${s.dailyReviewGoal || 0}"></div>
      <div class="field"><label>错题复习基础间隔（天，0=收录后立即到期；做对后自动拉长）</label>
        <input id="set-rbase" class="input" type="number" min="0" max="5" placeholder="3" value="${s.reviewBaseInterval != null ? s.reviewBaseInterval : 3}"></div>
      <div class="field"><label>每日复习受理上限（道/天，留空=自动按近期节奏；0=全量一天可见）</label>
        <input id="set-rcap" class="input" type="number" min="0" max="999" placeholder="自动" value="${s.dailyReviewCap > 0 ? s.dailyReviewCap : ''}"></div>
    `, `<button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="save-settings">保存</button>`), { lock: true });
    bindModalEvents();
    document.getElementById('save-settings').onclick = () => {
      Controller.updateSettings({
        school: document.getElementById('set-school').value.trim(),
        targetScore: document.getElementById('set-score').value === '' ? null : Number(document.getElementById('set-score').value),
        examDate: document.getElementById('set-exam').value || s.examDate,
        dailyReviewGoal: Math.max(0, Math.round(Number(document.getElementById('set-rgoal').value)) || 0),
        reviewBaseInterval: (function () {
          var n = Number(document.getElementById('set-rbase').value);
          return isNaN(n) ? 3 : Math.max(0, Math.min(5, Math.round(n)));
        })(),
        dailyReviewCap: (function () {
          var v = document.getElementById('set-rcap').value.trim();
          if (v === '') return -1;                       // 自动
          var n = Number(v);
          return isNaN(n) ? -1 : Math.max(0, Math.round(n)); // 0=不限，>0=固定
        })()
      });
      UI.closeModal(); render(); App.refreshTopbar();
      Toast.show('已保存设置');
    };
  }

  function openStudyLog() {
    const log = Controller.getStudyLog(todayStr());
    const rows = SUBJECTS.map(s => `
      <div class="field">
        <label>${esc(s.name)} 时长（分钟）</label>
        <input class="input study-min" data-subject="${s.key}" type="number" min="0" placeholder="0" value="${log[s.key] || 0}">
      </div>`).join('');
    UI.openModal(UI.modalShell('记录今日学习时长', `<div class="form-row">${rows}</div>`, `<button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="save-study">保存</button>`), { lock: true });
    bindModalEvents();
    // 只保存有改动的一科：记录新值 - 旧值
    document.getElementById('save-study').onclick = () => {
      document.querySelectorAll('.study-min').forEach(inp => {
        const subject = inp.getAttribute('data-subject');
        const newVal = Math.max(0, Number(inp.value) || 0);
        const oldVal = log[subject] || 0;
        if (newVal !== oldVal) Controller.logStudy(todayStr(), subject, newVal - oldVal);
      });
      UI.closeModal(); render(); App.refreshTopbar();
      Toast.show('学习时长已更新');
    };
  }

  function render() {
    const s = Controller.getState();
    const settings = s.settings;
    const days = daysUntil(settings.examDate);

    // 今日任务
    const today = todayStr();
    const todo = s.tasks.filter(t => t.dueDate === today);
    const todoDone = todo.filter(t => t.done).length;

    // 本周完成率
    const ws = weekStart();
    const thisWeek = s.tasks.filter(t => t.dueDate && t.dueDate >= ws && t.dueDate <= todayStr(6));
    const wkTotal = thisWeek.length;
    const wkDone = thisWeek.filter(t => t.done).length;
    const wkRate = wkTotal ? Math.round(wkDone / wkTotal * 100) : 0;

    // 今日学习时长
    const studyToday = Controller.todayStudyMinutes();

    // 今日复习目标（REQ-005）
    const todayRev = Controller.todayReviewedCount();
    const goal = settings.dailyReviewGoal || 0;
    const goalReached = goal > 0 && todayRev >= goal;
    const goalPct = goal > 0 ? Math.min(100, Math.round(todayRev / goal * 100)) : 0;
    const todayRevHtml = goal > 0
      ? `<div class="progress mt-2"><i style="width:${goalPct}%"></i></div>
         <div class="stat-sub mt-1">${goalReached ? '太棒了，今天的目标已完成！' : `还差 <b class="text-primary">${goal - todayRev}</b> 题，保持节奏`}</div>`
      : `<p class="muted small mt-2" style="margin-bottom:0">在「目标设置」里定一个每日要复习的题数，保持节奏。</p>`;

    const todoHtml = todo.length ? todo.slice(0, 12).map(t => `
      <label class="list-row ${t.done ? 'done' : ''}" style="cursor:pointer">
        <input type="checkbox" class="checkbox" data-todo="${esc(t.id)}" ${t.done ? 'checked' : ''}>
        <span class="grow row-title">${esc(t.title)}</span>
        <span class="chip ${PRIORITIES[t.priority].cls || ''}">${esc(PRIORITIES[t.priority].label)}</span>
      </label>`).join('') : `
      <div class="empty" style="padding:16px">
        <div>今天没有任务</div>
        <button class="btn btn-soft btn-sm mt-2" data-goto-plan>去安排一个</button>
      </div>`;

    const subjectHtml = SUBJECTS.map(su => {
      const pct = (s.subjects[su.key].percent || 0);
      const stage = s.subjects[su.key].stage;
      return `
      <div class="field" style="margin-bottom:12px">
        <div class="flex-between">
          <span class="c-sub"><span class="subject-dot ${'sd-' + su.key}"></span>${esc(su.name)}</span>
          <span class="small muted">${pct}% ${stage ? '· ' + esc(stage) : ''}</span>
        </div>
        <div class="progress mt-1"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');

    const schoolName = settings.school || '未设置目标院校';
    const scoreText = settings.targetScore === null ? '–' : settings.targetScore;

    el.innerHTML = `
      <div class="grid grid-cols-2">
        <!-- 倒计时 -->
        <div class="stat-card accent">
          <div class="stat-label">${UI.icon('clock', 15)} 距考试还有</div>
          <div class="stat-value"><span class="stat-num" data-count="${days === null ? '–' : days}">${days === null ? '–' : days}</span></div>
          <div class="stat-sub">${esc(settings.examDate)} 开考</div>
        </div>
        <!-- 目标卡 -->
        <div class="stat-card">
          <div class="stat-label flex-between">
            <span>${UI.icon('target', 15)} 目标</span>
            <button class="btn btn-xs btn-ghost" data-open-settings>设置</button>
          </div>
          <div class="stat-value stat-md">${esc(schoolName)}</div>
          <div class="stat-sub">目标分数 <b class="text-primary">${scoreText}</b></div>
        </div>
      </div>

      <div class="card mt-3">
        <div class="card-head">
          <div class="card-title"><span class="ico">${UI.icon('task', 15)}</span>今日任务 <span class="chip">${todoDone}/${todo.length}</span></div>
          <button class="btn btn-xs btn-ghost" data-goto-plan>管理</button>
        </div>
        ${todoHtml}
      </div>

      <div class="card mt-3">
        <div class="card-head">
          <div class="card-title"><span class="ico">${UI.icon('repeat', 15)}</span>今日复习目标
            ${goal > 0 ? `<span class="chip ${goalReached ? 'chip-ok' : ''}">${todayRev}/${goal}</span>` : ''}
            ${goalReached ? '<span class="chip chip-ok">已达成</span>' : ''}
          </div>
          <button class="btn btn-xs btn-ghost" data-open-settings>设置</button>
        </div>
        ${todayRevHtml}
      </div>

      <div class="grid grid-cols-2 mt-3">
        <div class="stat-card">
          <div class="stat-label">${UI.icon('timer', 15)} 今日学习时长</div>
          <div class="stat-value stat-lg">${fmtMinutes(studyToday)}</div>
          <button class="btn btn-xs btn-soft mt-2" data-log-study>记录</button>
        </div>
        <div class="stat-card">
          <div class="stat-label">${UI.icon('trend', 15)} 本周完成率</div>
          <div class="stat-value"><span class="stat-num" data-count="${wkTotal ? wkRate : 0}">${wkTotal ? wkRate : 0}</span><span style="font-size:18px">%</span></div>
          <div class="progress mt-1"><i style="width:${wkRate}%"></i></div>
          <div class="stat-sub">${wkDone}/${wkTotal} 项已完成</div>
        </div>
      </div>

      <div class="grid grid-cols-2 mt-3">
        <div class="card">
          <div class="card-title mb-2"><span class="ico">${UI.icon('book', 15)}</span>四科备考进度</div>
          ${subjectHtml}
          <button class="btn btn-xs btn-ghost mt-2" data-goto-plan>管理进度</button>
        </div>
        <div class="card">
          <div class="card-title mb-2"><span class="ico">${UI.icon('pencil', 15)}</span>错题快捷入口</div>
          <p class="muted small">用「四栏归因法」记录错题，自动统计薄弱点</p>
          <button class="btn btn-primary btn-full mt-3" data-goto-wrong>去错题簿</button>
        </div>
      </div>`;

    // 异步填充四科进度色（内联已渲染），无需 hydrate
  }

  return { mount, render };
})();
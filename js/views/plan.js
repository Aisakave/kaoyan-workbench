/* ===== views/plan.js =====
   学习计划 F-02：任务增删改（截止时间/优先级/完成状态），按日期分组 */

'use strict';

const PlanView = (() => {
  let el;

  function mount(container) {
    el = container;
    container.addEventListener('click', onClick);
    container.addEventListener('change', onChange);
    render();
  }

  function onClick(e) {
    const t = e.target.closest('[data-todo]');
    if (t) { Controller.toggleTask(t.getAttribute('data-todo')); render(); return; }
    if (e.target.closest('[data-add]')) openForm();
    const edit = e.target.closest('[data-edit]');
    if (edit) openForm(edit.getAttribute('data-edit'));
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.getAttribute('data-del');
      UI.confirm({
        title: '删除任务',
        message: '删除后该任务将无法恢复。确定删除？',
        onOk: () => { Controller.deleteTask(id); render(); }
      });
    }
  }
  function onChange() {}

  function openForm(id) {
    const s = Controller.getState();
    const tasks = s.tasks;
    const existing = id ? tasks.find(t => t.id === id) : null;
    const sel = existing || {};
    const subjectOpts = SUBJECTS.map(x => `<option value="${x.key}" ${x.key === sel.subject ? 'selected' : ''}>${x.name}</option>`).join('');
    const priOpts = Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${(sel.priority || 'mid') === k ? 'selected' : ''}>${v.label}</option>`).join('');

    UI.openModal(UI.modalShell(existing ? '编辑任务' : '新建任务', `
      <div class="field"><label>任务内容</label>
        <input id="t-title" class="input" placeholder="例：背完政治第二章" value="${esc(sel.title || '')}"></div>
      <div class="form-row">
        <div class="field"><label>科目</label>
          <select id="t-subject" class="select">${subjectOpts}</select></div>
        <div class="field"><label>截止日期</label>
          <input id="t-due" class="input" type="date" value="${esc(sel.dueDate || '')}"></div>
        <div class="field"><label>优先级</label>
          <select id="t-pri" class="select">${priOpts}</select></div>
      </div>
    `, `<button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-danger-soft" id="t-del" ${existing ? '' : 'hidden'}>删除</button>
        <button class="btn btn-primary" id="t-save">保存</button>`), { lock: true });

    bindModalEvents();
    const saveBtn = document.getElementById('t-save');
    saveBtn.onclick = () => {
      const title = document.getElementById('t-title').value.trim();
      if (!title) { Toast.show('请填写任务内容', 'warn'); return; }
      const data = {
        title,
        subject: document.getElementById('t-subject').value,
        dueDate: document.getElementById('t-due').value,
        priority: document.getElementById('t-pri').value
      };
      if (existing) Controller.updateTask(existing.id, data);
      else Controller.addTask(data);
      UI.closeModal(); render();
      Toast.show('已保存');
    };
    if (existing) {
      document.getElementById('t-del').onclick = () => {
        UI.closeModal(); Controller.deleteTask(existing.id); render(); Toast.show('已删除');
      };
    }
  }

  function render() {
    const tasks = Object.values(Controller.getState().tasks);
    // 按日期分组排序，未设日期的归入"未排期"
    const groups = {};
    tasks.forEach(t => {
      const key = t.dueDate || '__none__';
      (groups[key] = groups[key] || []).push(t);
    });
    const keys = Object.keys(groups).sort((a, b) => {
      if (a === '__none__') return 1; if (b === '__none__') return -1;
      return a < b ? -1 : 1;
    });

    const total = tasks.length;
    const done = tasks.filter(t => t.done).length;

    const bodyHtml = total ? keys.map(k => {
      const isNone = k === '__none__';
      const label = isNone ? '未排期' : `${dateLabel(k)} ${k === todayStr() ? '·今天' : ''}`;
      const rows = groups[k].map(t => `
        <div class="list-row ${t.done ? 'done' : ''}">
          <input type="checkbox" class="checkbox" data-todo="${esc(t.id)}" ${t.done ? 'checked' : ''}>
          <span class="chip ${'sd-' + t.subject}"></span>
          <div class="grow">
            <div class="row-title">${esc(t.title)}</div>
            <div class="small muted">${esc(SUBJECT_MAP[t.subject] ? SUBJECT_MAP[t.subject].name : '')}${t.dueDate ? ' · ' + dateLabel(t.dueDate) : ''}</div>
          </div>
          <span class="chip ${PRIORITIES[t.priority].cls || ''}">${esc(PRIORITIES[t.priority].label)}</span>
          <button class="btn btn-icon btn-ghost btn-sm" data-edit="${esc(t.id)}" title="编辑">${UI.icon('pencil', 15)}</button>
          <button class="btn btn-icon btn-danger-ghost btn-sm" data-del="${esc(t.id)}" title="删除">${UI.icon('trash', 15)}</button>
        </div>`).join('');
      return `<div class="mt-3" style="display:flex;align-items:center;gap:8px"><span class="chip chip-sub">${esc(label)}</span></div><div class="list">${rows}</div>`;
    }).join('') : `
      <div class="empty">
        <div class="empty-icon">${UI.icon('calendar', 28)}</div>
        <div class="empty-title">还没有学习计划</div>
        <div>点击下方按钮添加第一个任务</div>
      </div>`;

    el.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="ico">${UI.icon('calendar', 15)}</span>学习计划 <span class="chip">${done}/${total}</span></div>
        <button class="btn btn-primary" data-add>${UI.icon('plus', 15)} 新建任务</button>
      </div>
      ${bodyHtml}`;
  }

  return { mount, render };
})();
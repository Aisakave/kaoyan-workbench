/* ===== views/subject.js =====
   科目进度 F-03：四科各自的进度百分比与当前阶段 */

'use strict';

const SubjectView = (() => {
  let el;

  function mount(container) {
    el = container;
    container.addEventListener('click', onClick);
    onSlider();
    render();
  }
  function onClick(e) {
    const btn = e.target.closest('[data-edit-sub]');
    if (btn) openForm(btn.getAttribute('data-edit-sub'));
  }

  // 进度条内联编辑（滑动即时生效）
  function onSlider() {
    // 每次 render 后重新绑定，但需避免重复；使用事件委托更稳，这里简述为点击编辑
  }

  function openForm(key) {
    const sb = Controller.getSubject(key);
    const su = SUBJECT_MAP[key];
    UI.openModal(UI.modalShell(`${su.name} · 进度`, `
      <div class="field"><label>进度百分比（0-100）</label>
        <input id="sb-pct" class="input" type="range" min="0" max="100" value="${sb.percent || 0}">
        <div class="small muted text-center" id="sb-pct-show">${sb.percent || 0}%</div></div>
      <div class="field"><label>当前阶段</label>
        <input id="sb-stage" class="input" placeholder="例：一轮复习 / 强化 / 冲刺" value="${esc(sb.stage || '')}"></div>
    `, `<button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="sb-save">保存</button>`), { lock: true });
    bindModalEvents();
    document.getElementById('sb-pct').oninput = () => {
      document.getElementById('sb-pct-show').textContent = document.getElementById('sb-pct').value + '%';
    };
    document.getElementById('sb-save').onclick = () => {
      Controller.updateSubject(key, {
        percent: Number(document.getElementById('sb-pct').value),
        stage: document.getElementById('sb-stage').value.trim()
      });
      UI.closeModal(); render(); Toast.show('已保存');
    };
  }

  function render() {
    const subs = Controller.getState().subjects;
    const cards = SUBJECTS.map(su => {
      const sb = subs[su.key];
      const pct = sb.percent || 0;
      return `
      <div class="card">
        <div class="flex-between">
          <span class="card-title card-title-sm"><span class="subject-dot ${'sd-' + su.key}"></span>${esc(su.name)}</span>
          <button class="btn btn-xs btn-ghost" data-edit-sub="${su.key}">编辑</button>
        </div>
        <div class="stat-value stat-xl text-center" style="color:${su.color}">${pct}<span style="font-size:18px">%</span></div>
        <div class="progress mt-2"><i style="width:${pct}%;background:${su.color}"></i></div>
        <div class="small muted text-center mt-2">${esc(sb.stage || '未设置阶段')}</div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="ico">${UI.icon('book', 15)}</span>四科备考进度 <span class="chip">复习阶段一览</span></div>
      </div>
      <div class="grid grid-cols-4">${cards}</div>`;
  }

  return { mount, render };
})();
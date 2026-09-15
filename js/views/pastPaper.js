/* ===== views/pastPaper.js =====
   真题管理 F-04：简要记录（套数/日期/用时/得分/错题数），按科目归类 */

'use strict';

const PastPaperView = (() => {
  let el;

  function mount(container) {
    el = container;
    container.addEventListener('click', onClick);
    render();
  }
  function onClick(e) {
    if (e.target.closest('[data-add]')) openForm();
    const edit = e.target.closest('[data-edit]');
    if (edit) openForm(edit.getAttribute('data-edit'));
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.getAttribute('data-del');
      UI.confirm({
        title: '删除真题记录',
        message: '删除后该真题记录将无法恢复。确定删除？',
        onOk: () => { Controller.deletePaper(id); render(); }
      });
    }
  }

  function openForm(id) {
    const s = Controller.getState();
    const existing = id ? s.pastPapers.find(x => x.id === id) : null;
    const sel = existing || {};
    const subjectOpts = SUBJECTS.map(x => `<option value="${x.key}" ${x.key === sel.subject ? 'selected' : ''}>${x.name}</option>`).join('');
    UI.openModal(UI.modalShell(existing ? '编辑真题记录' : '记录真题', `
      <div class="field"><label>真题标题</label>
        <input id="p-title" class="input" placeholder="例：2023年全国卷" value="${esc(sel.title || '')}"></div>
      <div class="form-row">
        <div class="field"><label>科目</label><select id="p-subject" class="select">${subjectOpts}</select></div>
        <div class="field"><label>日期</label><input id="p-date" class="input" type="date" value="${esc(sel.date || todayStr())}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>用时（分钟）</label><input id="p-time" class="input" type="number" min="0" value="${sel.usedTimeMin || ''}"></div>
        <div class="field"><label>得分</label><input id="p-score" class="input" type="number" min="0" value="${sel.score === undefined ? '' : sel.score}"></div>
        <div class="field"><label>错题数</label><input id="p-wrong" class="input" type="number" min="0" value="${sel.wrongNum === undefined ? '' : sel.wrongNum}"></div>
      </div>
    `, `<button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="p-save">保存</button>`), { lock: true });
    bindModalEvents();
    document.getElementById('p-save').onclick = () => {
      const title = document.getElementById('p-title').value.trim();
      if (!title) { Toast.show('请填写标题', 'warn'); return; }
      const data = {
        title,
        subject: document.getElementById('p-subject').value,
        date: document.getElementById('p-date').value,
        usedTimeMin: Number(document.getElementById('p-time').value) || 0,
        score: document.getElementById('p-score').value === '' ? null : Number(document.getElementById('p-score').value),
        wrongNum: document.getElementById('p-wrong').value === '' ? null : Number(document.getElementById('p-wrong').value)
      };
      if (existing) Controller.updatePaper(existing.id, data);
      else Controller.addPaper(data);
      UI.closeModal(); render(); Toast.show('已保存');
    };
  }

  function render() {
    const papers = [...Object.values(Controller.getState().pastPapers)]
      .sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);

    const body = papers.length ? `<div class="card" style="padding:0;overflow:hidden">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>标题</th><th>科目</th><th>日期</th><th>用时</th><th>得分</th><th>错题</th><th></th></tr></thead>
        <tbody>
          ${papers.map(p => `
            <tr>
              <td class="bold">${esc(p.title)}</td>
              <td><span class="chip chip-sub">${esc(SUBJECT_MAP[p.subject] ? SUBJECT_MAP[p.subject].name : '')}</span></td>
              <td class="small muted">${esc(p.date || '–')}</td>
              <td>${p.usedTimeMin ? fmtMinutes(p.usedTimeMin) : '–'}</td>
              <td class="bold ${p.score === null ? 'muted' : ''}">${p.score === null ? '–' : p.score}</td>
              <td>${p.wrongNum === null ? '–' : p.wrongNum}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-icon btn-ghost btn-sm" data-edit="${esc(p.id)}">${UI.icon('pencil', 15)}</button>
                <button class="btn btn-icon btn-danger-ghost btn-sm" data-del="${esc(p.id)}">${UI.icon('trash', 15)}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div>` : `
      <div class="empty"><div class="empty-icon">${UI.icon('file', 28)}</div><div class="empty-title">暂无真题记录</div><div>记录你做过的真题，追踪得分与用时</div></div>`;

    el.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="ico">${UI.icon('file', 15)}</span>真题管理 <span class="chip">${papers.length} 套</span></div>
        <button class="btn btn-primary" data-add>${UI.icon('plus', 15)} 记录真题</button>
      </div>
      ${body}`;
  }

  return { mount, render };
})();
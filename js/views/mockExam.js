/* ===== views/mockExam.js =====
   模考成绩 F-05：成绩记录 + 趋势（按科目） */

'use strict';

const MockExamView = (() => {
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
        title: '删除模考记录',
        message: '删除后该成绩记录将无法恢复。确定删除？',
        onOk: () => { Controller.deleteMock(id); render(); }
      });
    }
  }

  function openForm(id) {
    const s = Controller.getState();
    const existing = id ? s.mockExams.find(x => x.id === id) : null;
    const sel = existing || {};
    const subjectOpts = SUBJECTS.map(x => `<option value="${x.key}" ${x.key === sel.subject ? 'selected' : ''}>${x.name}</option>`).join('');
    UI.openModal(UI.modalShell(existing ? '编辑模考成绩' : '记录模考成绩', `
      <div class="form-row">
        <div class="field"><label>科目</label><select id="m-subject" class="select">${subjectOpts}</select></div>
        <div class="field"><label>日期</label><input id="m-date" class="input" type="date" value="${esc(sel.date || todayStr())}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>分数</label><input id="m-score" class="input" type="number" min="0" value="${sel.score === undefined ? '' : sel.score}"></div>
        <div class="field"><label>满分（可选）</label><input id="m-full" class="input" type="number" min="0" value="${sel.fullScore === undefined || sel.fullScore === null ? '' : sel.fullScore}"></div>
      </div>
      <div class="field"><label>备注</label><textarea id="m-note" class="textarea" placeholder="本次模考感想 / 失分点">${esc(sel.note || '')}</textarea></div>
    `, `<button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="m-save">保存</button>`), { lock: true });
    bindModalEvents();
    document.getElementById('m-save').onclick = () => {
      const score = document.getElementById('m-score').value;
      if (score === '') { Toast.show('请填写分数', 'warn'); return; }
      const scoreNum = Number(score);
      if (!Number.isFinite(scoreNum) || scoreNum < 0) { Toast.show('分数需为不小于 0 的数字', 'warn'); return; }
      const fullRaw = document.getElementById('m-full').value;
      const fullNum = fullRaw === '' ? null : Number(fullRaw);
      if (fullNum !== null && (!Number.isFinite(fullNum) || fullNum <= 0)) { Toast.show('满分需为大于 0 的数字', 'warn'); return; }
      if (fullNum !== null && scoreNum > fullNum) { Toast.show('分数不能高于满分', 'warn'); return; }
      const data = {
        subject: document.getElementById('m-subject').value,
        date: document.getElementById('m-date').value,
        score: scoreNum,
        fullScore: fullNum,
        note: document.getElementById('m-note').value.trim()
      };
      if (existing) Controller.updateMock(existing.id, data);
      else Controller.addMock(data);
      UI.closeModal(); render(); Toast.show('已保存');
    };
  }

  function render() {
    const exams = [...Object.values(Controller.getState().mockExams)]
      .sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1);

    // 按科目趋势：合并为每科一串
    const bySub = {};
    exams.forEach(m => { (bySub[m.subject] = bySub[m.subject] || []).push(m); });
    const latest = {}; // 最近一次分数
    exams.forEach(m => { latest[m.subject] = m.score; });

    // 每科数据点：横跨时间的最新成绩轨迹
    let trendHtml = '';
    SUBJECTS.forEach(su => {
      const list = (bySub[su.key] || []).slice(); // 已按日期升序
      let points = '';
      // 归一化轨迹：高度用满分或自身最高相对值
      const maxScore = Math.max(...(list.map(x => x.fullScore !== null && x.fullScore > 0 ? x.fullScore : x.score)), 1);
      points = list.map((m) => {
        const h = Math.max(8, Math.round((m.score / maxScore) * 60));
        return `<div class="tr-point" style="height:${h}px">${m.score}</div>`;
      }).join('');
      trendHtml += list.length ? `
        <div class="card mt-3">
          <div class="card-head"><div class="card-title"><span class="subject-dot ${'sd-' + su.key}"></span>${esc(su.name)} 趋势</div>
            <span class="chip">最近 ${esc(list[list.length-1].score)}</span></div>
          <div class="tr-track">${points}</div>
        </div>` : '';
    });

    const listHtml = exams.length ? exams.slice().reverse().map(m => `
      <div class="list-row">
        <span class="chip arrow-up"></span>
        <span class="chip ${'sd-' + m.subject}"></span>
        <div class="grow">
          <div class="row-title bold">${esc(m.score)}${m.fullScore ? ' / ' + m.fullScore : ''}</div>
          <div class="small muted">${esc(SUBJECT_MAP[m.subject] ? SUBJECT_MAP[m.subject].name : '')} · ${esc(m.date || '')}${m.note ? ' · ' + esc(m.note) : ''}</div>
        </div>
        <button class="btn btn-icon btn-ghost btn-sm" data-edit="${esc(m.id)}">${UI.icon('pencil', 15)}</button>
        <button class="btn btn-icon btn-danger-ghost btn-sm" data-del="${esc(m.id)}">${UI.icon('trash', 15)}</button>
      </div>`).join('') : '';

    el.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="ico">${UI.icon('trophy', 15)}</span>模考成绩 <span class="chip">${exams.length} 次</span></div>
        <button class="btn btn-primary" data-add>${UI.icon('plus', 15)} 记录成绩</button>
      </div>
      ${trendHtml}
      ${exams.length ? `<div class="card mt-3" style="padding:0"><div class="card-head" style="padding:14px 18px 0;margin-bottom:4px"><div class="card-title">${UI.icon('list', 15)} 全部记录</div></div>
        <div class="list">${listHtml}</div></div>` : `<div class="empty"><div class="empty-icon">${UI.icon('trophy', 28)}</div><div class="empty-title">暂无模考成绩</div><div>记录每次模考，查看科目进步趋势</div></div>`}`;
  }

  return { mount, render };
})();
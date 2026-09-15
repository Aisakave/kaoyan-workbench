/* ===== views/material.js =====
   资料库 F-06：图文资料 + 标签 + 搜索 + 按科目浏览（图片存 IndexedDB） */

'use strict';

const MaterialView = (() => {
  let el;
  let searchText = '';
  let filterSubject = 'all';
  const PAGE = 24;   // 每批渲染条数（3列布局）
  let shown = PAGE;

  function mount(container) {
    el = container;
    container.addEventListener('click', onClick);
    container.addEventListener('input', onInput);
    render();
  }

  function onInput(e) {
    if (e.target.id === 'mat-search') {
      searchText = e.target.value.trim().toLowerCase();
      shown = PAGE;
      refreshGrid();
    }
  }
  // 只更新结果网格：分批渲染 + 懒加载图片，避免全量铺 DOM 与全量读图
  function refreshGrid() {
    const grid = el.querySelector('#matGrid');
    if (!grid) return;
    grid.innerHTML = gridHTML(getFiltered());
    UI.hydrateThumbs(grid);
  }
  function onClick(e) {
    if (e.target.closest('[data-add]')) openForm();
    const edit = e.target.closest('[data-edit]');
    if (edit) openForm(edit.getAttribute('data-edit'));
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.getAttribute('data-del');
      UI.confirm({
        title: '删除资料',
        message: '删除后该资料及其图片将一并移除，且无法恢复。确定删除？',
        onOk: () => {
          const m = Controller.getState().materials.find(x => x.id === id);
          ((m && m.images) || []).forEach(UI.releaseImage);
          Controller.deleteMaterial(id); render();
        }
      });
    }
    const fb = e.target.closest('[data-filter-sub]');
    if (fb) { filterSubject = fb.getAttribute('data-filter-sub'); render(); }
    // 加载更多
    const more = e.target.closest('[data-loadmore]');
    if (more) { shown += PAGE; refreshGrid(); }
    // 点开看原图
    const thumb = e.target.closest('img.img-thumb');
    if (thumb) { UI.lightboxById(thumb.getAttribute('data-oid')); return; }
    // 删除单张图
    const delImg = e.target.closest('[data-del-img]');
    if (delImg) {
      const id = delImg.getAttribute('data-del-img');
      Controller.updateMaterial(delImg.getAttribute('data-mat'), { images: (Controller.getState().materials.find(m => m.id === delImg.getAttribute('data-mat')) || {}).images.filter(x => x !== id) });
      UI.releaseImage(id);
      Store.deleteImage(id);
      render();
    }
  }

  function openForm(id) {
    const s = Controller.getState();
    const existing = id ? s.materials.find(x => x.id === id) : null;
    const sel = existing || {};
    const subjectOpts = SUBJECTS.map(x => `<option value="${x.key}" ${x.key === sel.subject ? 'selected' : ''}>${x.name}</option>`).join('');
    UI.openModal(UI.modalShell(existing ? '编辑资料' : '添加资料', `
      <div class="field"><label>标题</label>
        <input id="mat-title" class="input" value="${esc(sel.title || '')}" placeholder="例：政治背诵要点"></div>
      <div class="field"><label>科目</label>
        <select id="mat-subject" class="select">${subjectOpts}</select></div>
      <div class="field"><label>标签（空格分隔）</label>
        <input id="mat-tags" class="input" value="${esc((sel.tags || []).join(' '))}" placeholder="例：肖四 选择题"></div>
      <div class="field"><label>备注</label>
        <textarea id="mat-note" class="textarea" placeholder="文字说明或知识点摘要">${esc(sel.note || '')}</textarea></div>
      <div class="field"><label>知识图片</label>
        <div class="imgs" id="mat-imglist"></div>
        <button class="btn btn-soft btn-sm mt-2" type="button" id="mat-addimg">${UI.icon('camera', 15)} 上传/拍照图片</button></div>
    `, `<button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="mat-save">保存</button>`), { lock: true });
    bindModalEvents();

    let newImgs = (sel.images || []).slice();
    const imgList = document.getElementById('mat-imglist');
    function renderImgs() {
      imgList.innerHTML = newImgs.map(b => UI.thumbHTML(b)).join('');
      UI.hydrateThumbs(imgList);
    }
    renderImgs();
    // 删除图片（表单中）
    imgList.onclick = (e) => {
      const d = e.target.closest('[data-del]');
      if (d) { newImgs = newImgs.filter(x => x !== d.getAttribute('data-del')); renderImgs(); }
    };
    document.getElementById('mat-addimg').onclick = () => UI.pickImages(ids => {
      newImgs = newImgs.concat(ids); renderImgs();
    });
    document.getElementById('mat-save').onclick = () => {
      const title = document.getElementById('mat-title').value.trim();
      if (!title) { Toast.show('请填写标题', 'warn'); return; }
      const data = {
        title,
        subject: document.getElementById('mat-subject').value,
        tags: document.getElementById('mat-tags').value.split(/\s+/).filter(Boolean),
        note: document.getElementById('mat-note').value.trim(),
        images: newImgs
      };
      if (existing) Controller.updateMaterial(existing.id, data);
      else Controller.addMaterial(data);
      UI.closeModal(); render(); Toast.show('已保存');
    };
  }

  function getFiltered() {
    let mats = [...Object.values(Controller.getState().materials)]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (filterSubject !== 'all') mats = mats.filter(m => m.subject === filterSubject);
    if (searchText) {
      mats = mats.filter(m =>
        (m.title || '').toLowerCase().includes(searchText) ||
        (m.note || '').toLowerCase().includes(searchText) ||
        (m.tags || []).some(t => t.toLowerCase().includes(searchText))
      );
    }
    return mats;
  }

  function gridHTML(mats) {
    const slice = mats.slice(0, shown);
    if (!slice.length) {
      return `<div class="empty"><div class="empty-icon">${UI.icon('folder', 28)}</div><div class="empty-title">暂无资料</div><div>上传知识点图片或记录资料，随时检索</div></div>`;
    }
    let html = slice.map(m => `
      <div class="card">
        <div class="flex-between">
          <span class="chip chip-sub">${esc(SUBJECT_MAP[m.subject] ? SUBJECT_MAP[m.subject].name : '')}</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-icon btn-ghost btn-sm" data-edit="${esc(m.id)}">${UI.icon('pencil', 15)}</button>
            <button class="btn btn-icon btn-danger-ghost btn-sm" data-del="${esc(m.id)}">${UI.icon('trash', 15)}</button>
          </div>
        </div>
        <div class="card-title card-title-sm" style="margin:8px 0 4px">${esc(m.title)}</div>
        ${m.note ? `<div class="small muted mb-1">${esc(m.note)}</div>` : ''}
        ${(m.tags && m.tags.length) ? `<div class="flex-wrap" style="display:flex;gap:5px;margin-bottom:6px">${m.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
        ${(m.images && m.images.length) ? `<div class="imgs">${m.images.map(b => `<img class="img-thumb" data-oid="${esc(b)}" data-src="">`).join('')}</div>` : ''}
      </div>`).join('');
    if (mats.length > shown) {
      html += `<div class="loadmore" style="grid-column:1/-1"><button class="btn btn-ghost" data-loadmore>${UI.icon('more', 14)} 加载更多（还有 ${mats.length - shown} 条）</button></div>`;
    }
    return html;
  }

  function render() {
    shown = PAGE;
    const mats = getFiltered();

    const filterChips = [['all','全部'], ...SUBJECTS.map(s => [s.key, s.name])].map(([k, n]) =>
      `<button class="chip ${k === filterSubject ? 'chip-sub' : ''}" data-filter-sub="${k}" style="cursor:pointer">${n}</button>`).join('');

    const count = mats.length;

    el.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="ico">${UI.icon('folder', 15)}</span>资料库 <span class="chip">${count} 条</span></div>
        <button class="btn btn-primary" data-add>${UI.icon('plus', 15)} 添加资料</button>
      </div>
      <div class="filter-bar">
        ${filterChips}
        <input id="mat-search" class="input select-inline grow" placeholder="搜索标题/标签/内容" value="${esc(searchText)}">
      </div>
      <div id="matGrid" class="grid grid-cols-3"></div>`;
    refreshGrid();
  }

  return { mount, render };
})();
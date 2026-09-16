/* ===== views/wrongBook.js =====
   错题簿 F-07（核心）：四栏归因法 + 图片上传 + 复发记忆 + 薄弱点统计 + 按科目/掌握度筛选 */

'use strict';

const WrongBookView = (() => {
  let el;
  let filterSubject = 'all';
  let filterStatus = 'all'; // all | undone | recur | permanent
  let filterType = 'all';  // 错误类型筛选
  let filterKeyword = '';  // 关键词搜索
  let tab = 'all';          // all | review | rank
  const PAGE = 20;          // 每批渲染条数
  let shown = PAGE;         // 已展示条数
  let rvTimer = null;       // 复习计时句柄（REQ-007）
  let rvStart = 0;          // 复习开始时间戳
  let sortBy = 'update';    // update(最近操作) | created(添加时间)
  let sortDir = 'desc';     // desc(最新在前) | asc(最早在前)
  function stopTimer() { if (rvTimer) { clearInterval(rvTimer); rvTimer = null; } }

  function mount(container) {
    el = container;
    container.addEventListener('click', onClick);
    container.addEventListener('input', onInput);
    const q = new URLSearchParams((location.hash.split('?')[1] || ''));
    tab = q.get('tab') === 'review' ? 'review' : (q.get('tab') === 'rank' ? 'rank' : 'all');
    render();
  }

  function onInput(e) {
    const box = e.target.closest('[data-search]');
    if (box) { filterKeyword = box.value.trim().toLowerCase(); shown = PAGE; refreshList(); }
  }

  // 统一排序：按字段 + 方向（desc 最新在前 / asc 最早在前）
  function sortWrong(list) {
    const mul = sortDir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      if (sortBy === 'created') return mul * ((b.created || b.updated || 0) - (a.created || a.updated || 0));
      return mul * ((b.updated || b.created || 0) - (a.updated || a.created || 0));
    });
  }

  // 只更新结果区：分批渲染 + 懒加载图片，避免一次铺满整页与全量读图
  function refreshList() {
    const s = Controller.getState();
    const all = sortWrong(Object.values(s.wrongQuestions));
    const box = el.querySelector('#wrongCards');
    if (!box) return;
    box.innerHTML = listHTML(getFiltered(all));
    UI.hydrateThumbs(box);
  }

  function getFiltered(all) {
    let list = all;
    if (filterSubject !== 'all') list = list.filter(w => w.subject === filterSubject);
    if (filterStatus !== 'all') {
      if (filterStatus === 'permanent') list = list.filter(w => w.permanent);
      else if (filterStatus === 'mastered') list = list.filter(w => !w.permanent && (w.reviewCount || 0) >= 3);
      else if (filterStatus === 'recur') list = list.filter(w => !w.permanent && (w.reviewCount || 0) < 3 && w.recurCount >= 1);
      else if (filterStatus === 'undone') list = list.filter(w => !w.permanent && (w.reviewCount || 0) < 3 && w.recurCount === 0);
    }
    if (filterType !== 'all') {
      list = list.filter(w =>
        (w.errorTypes || []).includes(filterType) ||
        (filterType === 'other' && w.customError));
    }
    if (filterKeyword) {
      list = list.filter(w => {
        const typeText = (w.errorTypes || []).map(t => ERROR_TYPE_MAP[t] || t).join(' ');
        const hay = `${w.title || ''} ${w.keyStep || ''} ${w.customError || ''} ${typeText}`.toLowerCase();
        return hay.includes(filterKeyword);
      });
    }
    return list;
  }

  function listHTML(list) {
    const slice = list.slice(0, shown);
    if (!slice.length) {
      return `<div class="empty"><div class="empty-icon">${UI.icon('pencil', 28)}</div><div class="empty-title">没有符合条件的错题</div><div>点击右上角「收录错题」开始记录</div></div>`;
    }
    let html = `<div class="grid grid-cols-2">${slice.map(w => wrongCard(w)).join('')}</div>`;
    if (list.length > shown) {
      html += `<div class="loadmore"><button class="btn btn-ghost" data-loadmore>${UI.icon('more', 14)} 加载更多（还有 ${list.length - shown} 条）</button></div>`;
    }
    return html;
  }

  function onClick(e) {
    const tb = e.target.closest('[data-tab]');
    if (tb) { switchTab(tb.getAttribute('data-tab')); return; }
    const rev = e.target.closest('[data-review]');
    if (rev) { openReview(rev.getAttribute('data-review')); return; }
    if (e.target.closest('[data-bulkimport]')) { openBulkImport(); return; }
    if (e.target.closest('[data-add]')) openForm();
    const edit = e.target.closest('[data-edit]');
    if (edit) openForm(edit.getAttribute('data-edit'));
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.getAttribute('data-del');
      UI.confirm({
        title: '删除错题',
        message: '删除后该错题的图片与复习记录将一并移除，且无法恢复。确定删除？',
        onOk: () => {
          const wq = Controller.getState().wrongQuestions.find(w => w.id === id);
          ((wq && wq.images) || []).forEach(UI.releaseImage);
          Controller.deleteWrongQuestion(id); render();
        }
      });
    }
    // 再错 +1
    const bump = e.target.closest('[data-bump]');
    if (bump) { Controller.bumpWrong(bump.getAttribute('data-bump')); render(); }
    // 筛选
    const fsub = e.target.closest('[data-fsub]');
    if (fsub) { filterSubject = fsub.getAttribute('data-fsub'); render(); }
    const fstat = e.target.closest('[data-fstat]');
    if (fstat) { filterStatus = fstat.getAttribute('data-fstat'); render(); }
    const ftype = e.target.closest('[data-ftype]');
    if (ftype) { filterType = ftype.getAttribute('data-ftype'); render(); }
    // 排序切换（仅刷新结果区 + 就地更新胶囊高亮，保留输入焦点）
    const srt = e.target.closest('[data-sort]');
    if (srt) {
      sortBy = srt.getAttribute('data-sort'); shown = PAGE;
      const row = srt.closest('.sort-row');
      if (row) row.querySelectorAll('[data-sort]').forEach(b =>
        b.classList.toggle('chip-sub', b.getAttribute('data-sort') === sortBy));
      refreshList();
    }
    // 排序方向切换（最新在前 / 最早在前）：就地更新按钮文案与箭头
    const sdir = e.target.closest('[data-sortdir]');
    if (sdir) {
      const dir = sortDir = sortDir === 'asc' ? 'desc' : 'asc'; shown = PAGE;
      sdir.innerHTML = `${dir === 'asc'
        ? `<svg class="ico-svg" style="transform:rotate(180deg)" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-more"></use></svg>`
        : UI.icon('more', 12)} ${dir === 'asc' ? '最早在前' : '最新在前'}`;
      refreshList();
    }
    // 加载更多
    const more = e.target.closest('[data-loadmore]');
    if (more) { shown += PAGE; refreshList(); }
    // 点开看原图
    const thumb = e.target.closest('img.img-thumb');
    if (thumb) { UI.lightboxById(thumb.getAttribute('data-oid')); return; }
  }
  function onChange() {}

  // ---- 错题复习与排行榜（F-08）----
  function switchTab(t) {
    tab = t;
    history.replaceState(null, '', '#/wrong?tab=' + t);
    render();
  }

  function baseInterval() { return Controller.getSettings().reviewBaseInterval; }
  // 首次到期（从未复习）的提示文案
  function firstDueText() {
    const b = baseInterval();
    return b > 0 ? `创建后 ${b} 天首次到期` : '收录后即进入待复习队列';
  }

  function reviewStatusText(w) {
    const meta = reviewMeta(w, baseInterval());
    if (!w.lastReviewedAt) return '从未复习 · ' + firstDueText();
    const lv = overdueLevel(meta.overdueDays);
    if (lv) {
      const cls = lv === 'danger' ? 'text-danger' : lv === 'warn' ? 'od-warn' : 'od-due';
      return `上次复习 ${meta.daysSince} 天前 · <span class="${cls}">逾期 ${meta.overdueDays} 天</span>`;
    }
    return meta.daysToDue === 0 ? '上次复习 ' + meta.daysSince + ' 天前 · 今日到期'
      : `上次复习 ${meta.daysSince} 天前 · 剩 ${meta.daysToDue} 天到期`;
  }

  // 复习历史轨迹（P1/REQ-005）：最近数次对错 + 累计正确率，历史为空则不显示
  function historyHTML(w) {
    const hist = (w.reviewHistory || []).slice(-8);
    if (!hist.length) return '';
    const total = hist.length;
    const correct = hist.filter(h => h.correct).length;
    const rate = Math.round(correct / total * 100);
    const dots = hist.map(h => {
      const d = toDateStr(new Date(h.at));
      let tip = `${esc(d)} · ${h.correct ? '做对' : '做错'}`;
      if (h.elapsedSec) tip += ` · 耗时 ${fmtDur(h.elapsedSec)}`;
      if (!h.correct && (h.reasonKey || h.reasonText)) {
        const rk = (h.reasonKey && ERROR_TYPE_MAP[h.reasonKey]) ? ERROR_TYPE_MAP[h.reasonKey] : (h.reasonKey || '');
        tip += ` · 错因：${esc([rk, h.reasonText || ''].filter(Boolean).join(' '))}`;
      }
      return `<span class="h-dot ${h.correct ? 'h-ok' : 'h-no'}" title="${tip}">${h.correct ? UI.icon('check', 10) : UI.icon('x', 10)}</span>`;
    }).join('');
    return `<div class="wc-history"><span class="small muted">近期 ${total} 次</span>${dots}<span class="small ${rate === 100 ? 'text-primary' : 'muted'}">正确率 ${rate}%</span></div>`;
  }

  // 最近一次做错且带错因的记录（REQ-007 展示增强）
  function lastWrongReason(w) {
    const hist = w.reviewHistory || [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const h = hist[i];
      if (h && h.correct === false && (h.reasonKey || h.reasonText)) return h;
    }
    return null;
  }

  function reviewCard(w, meta) {
    const subjectName = SUBJECT_MAP[w.subject] ? SUBJECT_MAP[w.subject].name : '';
    const typeNames = (w.errorTypes || []).map(t => ERROR_TYPE_MAP[t] || t).join(' / ');
    const fullType = [typeNames, w.customError].filter(Boolean).join(' / ');
    const lv = overdueLevel(meta.overdueDays);
    const odChip = lv
      ? `<span class="chip ${lv === 'danger' ? 'od-danger' : lv === 'warn' ? 'od-warn' : 'od-due'}">逾期 ${meta.overdueDays} 天</span>`
      : '';
    return `
      <div class="wrong-card ${lv ? 'od-' + lv : ''}">
        <div class="wc-top">
          <span class="chip chip-sub">${esc(subjectName)}</span>
          ${w.permanent ? `<span class="chip chip-err">${UI.icon('flag', 13)} 永久保留</span>` : ''}
          ${!w.permanent && (w.reviewCount || 0) >= 3 ? `<span class="chip chip-ok">${UI.icon('check', 13)} 已掌握</span>` : ''}
          ${odChip}
          <div class="grow"></div>
          <span class="recur ${w.recurCount >= 3 ? 'danger' : ''}">${UI.icon('repeat', 13)} ${w.recurCount}</span>
          <button class="btn btn-icon btn-ghost btn-sm" data-edit="${esc(w.id)}">${UI.icon('pencil', 15)}</button>
        </div>
        <div class="wc-title">${w.title ? esc(w.title) : '<span class="muted small">（未填知识点）</span>'}</div>
        <div class="wc-grid">
          <div class="wc-field"><span class="k">我错在哪</span>
            <span class="v">${fullType ? esc(fullType) : '<span class="muted small">–</span>'}</span></div>
          <div class="wc-field"><span class="k">${w.lastReviewedAt ? '上次复习' : '复习状态'}</span>
            <span class="v">${w.lastReviewedAt ? meta.daysSince + ' 天前' : firstDueText()}</span></div>
        </div>
        ${(() => {
          const lw = lastWrongReason(w);
          if (!lw) return '';
          const rk = (lw.reasonKey && ERROR_TYPE_MAP[lw.reasonKey]) ? ERROR_TYPE_MAP[lw.reasonKey] : (lw.reasonKey || '');
          const s = [rk, lw.reasonText || ''].filter(Boolean).join(' · ');
          return `<div class="wc-field rv-reason-field"><span class="k">${UI.icon('clock', 12)} 再错错因</span><span class="v"><b>${esc(s)}</b></span></div>`;
        })()}
        ${(w.images && w.images.length) ? `<div class="imgs">${w.images.map(b => `<img class="img-thumb" data-oid="${esc(b)}" data-src="">`).join('')}</div>` : ''}
        ${historyHTML(w)}
        <div class="mt-2 flex-between">
          <button class="btn btn-primary btn-sm" data-review="${esc(w.id)}">${UI.icon('review', 15)} 复习</button>
          <span class="small muted">下次间隔 ${nextReviewInterval(w.reviewCount, baseInterval())} 天</span>
        </div>
      </div>`;
  }

  function renderReviewTab(body) {
    const q = Controller.reviewDueQueue();
    const capInfo = q.capSummary;
    if (capInfo.total === 0) {
      const b = baseInterval();
      body.innerHTML = `<div class="empty"><div class="empty-icon">${UI.icon('ok', 28)}</div><div class="empty-title">暂无到期待复习错题</div><div>新错题${b > 0 ? '创建 ' + b + ' 天后' : '收录后'}自动进入队列，保持节奏！</div></div>`;
      return;
    }
    const parts = [];
    // 顶部统计：到期总数 + 今日受理数
    let statBits = [`到期 ${capInfo.total} 题`];
    if (capInfo.shown && capInfo.shown !== capInfo.total) statBits.push(`今日受理 ${capInfo.shown} 题`);
    if (capInfo.deferred) statBits.push(`顺延 ${capInfo.deferred} 题`);
    parts.push(`<div class="small muted mb-2">${statBits.join(' · ')} · 复习 = 重做后标记结果</div>`);
    // 活动受理区
    if (q.list.length) {
      parts.push(`<div class="grid grid-cols-2">${q.list.map(({ w, meta }) => reviewCard(w, meta)).join('')}</div>`);
    } else if (capInfo.shown === 0 && capInfo.total > 0) {
      const tip = capInfo.deferred
        ? `今日已受理完毕，其余 ${capInfo.deferred} 题已顺延，明天优先补进`
        : (capInfo.stabilized ? '今日到期题均已达稳定掌握，暂不催办' : '今日已受理完毕');
      parts.push(`<div class="empty"><div class="empty-icon">${UI.icon('clock', 26)}</div><div class="empty-title">暂无今日需受理</div><div>${tip}</div></div>`);
    }
    // 顺延区（默认折叠可展开）
    if (q.deferred.length) {
      parts.push(`<details class="rv-more"><summary>另有 ${q.deferred.length} 题已顺延（逾期久的优先，明日自动补进）</summary>
        <div class="grid grid-cols-2">${q.deferred.map(({ w, meta }) => reviewCard(w, meta)).join('')}</div></details>`);
    }
    // 稳定收纳区（默认折叠）
    if (q.stabilized.length) {
      parts.push(`<details class="rv-more"><summary>${q.stabilized.length} 题已稳定掌握，暂不催办（做错会自动回归）</summary>
        <div class="small muted mb-1">达到 30 天档且最近连续 2 次做对、逾期未超 7 天</div>
        <div class="grid grid-cols-2">${q.stabilized.map(({ w, meta }) => reviewCard(w, meta)).join('')}</div></details>`);
    }
    body.innerHTML = parts.join('');
    UI.hydrateThumbs(body);
  }

  function renderRankTab(body) {
    const top = Controller.ranking(10);
    if (!top.length) {
      body.innerHTML = `<div class="empty"><div class="empty-icon">${UI.icon('trophy', 28)}</div><div class="empty-title">暂无排行数据</div><div>收录错题并「再错+1」后，这里按复发次数排序</div></div>`;
      return;
    }
    const tiers = ['gold', 'silver', 'bronze'];
    body.innerHTML = `
      <div class="card mt-2">
        <div class="card-title mb-sm"><span class="ico">${UI.icon('trophy', 15)}</span>复发次数 Top 10 <span class="chip">按「再错+1」累计排行</span></div>
        <div class="rank-list">
          ${top.map((w, i) => {
            const subjectName = SUBJECT_MAP[w.subject] ? SUBJECT_MAP[w.subject].name : '';
            return `
            <div class="rank-row">
              <span class="rank-num ${i < 3 ? 'medal ' + tiers[i] : ''}">${i < 3 ? UI.icon('medal', 15) : i + 1}</span>
              <span class="chip chip-sub">${esc(subjectName)}</span>
              <span class="rank-title">${w.title ? esc(w.title) : '<span class="muted small">（未填知识点）</span>'}</span>
              ${w.permanent ? `<span class="chip chip-err">${UI.icon('flag', 13)}</span>` : ''}
              <div class="grow"></div>
              <span class="recur ${w.recurCount >= 3 ? 'danger' : ''}">${UI.icon('repeat', 13)} ${w.recurCount}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function openReview(id) {
    const s = Controller.getState();
    const w = s.wrongQuestions.find(x => x.id === id);
    if (!w) return;
    const meta = reviewMeta(w, baseInterval());
    const subjectName = SUBJECT_MAP[w.subject] ? SUBJECT_MAP[w.subject].name : '';
    const typeNames = (w.errorTypes || []).map(t => ERROR_TYPE_MAP[t] || t).join(' / ');
    const fullType = [typeNames, w.customError].filter(Boolean).join(' / ');
    UI.openModal(UI.modalShell('复习错题', `
      <div class="small muted mb-2" style="text-align:right">${UI.icon('timer', 14)} <b id="rv-timer" class="text-primary">00:00</b></div>
      <div class="flex mb-2" style="gap:8px;flex-wrap:wrap">
        <span class="chip chip-sub">${esc(subjectName)}</span>
        ${w.permanent ? `<span class="chip chip-err">${UI.icon('flag', 13)} 永久保留</span>` : ''}
        <span class="chip">${UI.icon('repeat', 13)} ${w.recurCount}</span>
      </div>
      <div class="wc-title mb-2">${w.title ? esc(w.title) : '<span class="muted small">（未填知识点）</span>'}</div>
      ${fullType ? `<div class="small muted mb-2">我错在哪：${esc(fullType)}</div>` : ''}
      ${(w.images && w.images.length) ? `<div class="imgs mb-2">${w.images.map(b => `<img class="img-thumb" data-oid="${esc(b)}" data-src="">`).join('')}</div>` : ''}
      <div class="small muted mb-2">${w.lastReviewedAt
        ? `上次复习 ${meta.daysSince} 天前，本次间隔 ${nextReviewInterval(w.reviewCount, baseInterval())} 天`
        : firstDueText()}</div>
      ${historyHTML(w)}
      <div id="rv-reason" class="rv-reason">
        <div class="field">
          <label>再错原因（这一遍为啥又错了，可不填直接结束）</label>
          <div class="radio-row" id="rv-reason-chips">${ERROR_TYPES.map(t => `
            <button type="button" class="radio-chip rv-reason-chip" data-rk="${t.key}">${esc(t.label)}</button>`).join('')}</div>
          <input id="rv-reason-text" class="input mt-1" style="display:none" placeholder="自定义再错原因">
        </div>
        <button class="btn btn-primary grow" id="rv-reason-ok">确认错因并结束</button>
      </div>
      <div class="review-btns mt-2">
        <button class="btn btn-primary grow" id="rv-correct">${UI.icon('check', 15)} 做对了</button>
        <button class="btn btn-danger grow" id="rv-wrong">${UI.icon('x', 15)} 又做错了</button>
      </div>
    `), { lock: true });
    const mask = document.getElementById('modalMask');
    UI.hydrateThumbs(mask);
    mask.onclick = (e) => {
      const thumb = e.target.closest('img.img-thumb');
      if (thumb) UI.lightboxById(thumb.getAttribute('data-oid'));
    };
    bindModalEvents();
    // 点 ✕ 关闭：停表，本次复习作废（不计时、不记录）
    mask.querySelector('[data-close]').onclick = () => { stopTimer(); UI.closeModal(); };

    // 计时：打开即开始，做对/确认错因时停止并记录；✕ 退出不计时
    rvStart = Date.now();
    const timerEl = document.getElementById('rv-timer');
    function clock(sec) {
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      return mm + ':' + ss;
    }
    function tick() { timerEl.textContent = clock(Math.max(0, Math.floor((Date.now() - rvStart) / 1000))); }
    stopTimer(); rvTimer = setInterval(tick, 1000); tick();

    // 再错错因：单选预设（选「其他」显示自定义框），确认后随本次复习落库
    let rk = '';
    const chips = Array.from(mask.querySelectorAll('.rv-reason-chip'));
    const rText = document.getElementById('rv-reason-text');
    chips.forEach(c => c.onclick = () => {
      rk = c.getAttribute('data-rk');
      chips.forEach(x => x.classList.toggle('selected', x.getAttribute('data-rk') === rk));
      rText.style.display = (rk === 'other') ? '' : 'none';
      if (rk !== 'other') rText.value = '';
    });
    document.getElementById('rv-wrong').onclick = () => {
      const panel = document.getElementById('rv-reason');
      panel.classList.add('open');
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    document.getElementById('rv-reason-ok').onclick = () => {
      finishReview(id, false, {
        reasonKey: (rk && rk !== 'other') ? rk : (rk === 'other' ? 'other' : ''),
        reasonText: (rk === 'other' && rText.value.trim()) ? rText.value.trim() : ''
      });
    };
    document.getElementById('rv-correct').onclick = () => finishReview(id, true);
  }

  function finishReview(id, correct, opts) {
    const elapsedSec = Math.max(0, Math.round((Date.now() - rvStart) / 1000));
    const r = Controller.markReviewed(id, correct, Object.assign({ elapsedSec }, opts || {}));
    stopTimer();
    UI.closeModal();
    render();
    const b = baseInterval();
    if (correct) Toast.show(`已复习，下次 ${nextReviewInterval(r.reviewCount, b)} 天后到期`);
    else Toast.show(r.permanent ? '又做错+1（已永久保留），下次 3 天后重学' : '又做错+1，下次 ' + (b > 0 ? b + ' 天' : '立即') + '重学');
  }

  // ---- 批量导入（REQ-013）：选文件夹 → 按修改时间排序两两配对 → 预览确认 → 只新增写入 ----
  // 首次引导跳过标记（独立于业务数据的 localStorage，不随备份导出）
  const BULK_GUIDE_KEY = 'kylc:bulkGuide';

  function openBulkImport() {
    if (!localStorage.getItem(BULK_GUIDE_KEY)) { showBulkGuide(); return; }
    pickBulkFolder();
  }

  // 首次使用引导（REQ-014）：先看 4 步流程再选文件夹；勾选「不再显示」后恢复快捷路径
  function showBulkGuide() {
    UI.openModal(UI.modalShell('批量导入 · 使用引导', `
      <p class="modal-msg">第一次用别慌，照着下面 4 步做，当天错题一次就能导入完。</p>
      ${bulkGuideStepsHTML()}
      <p class="modal-msg bi-guide-note">配对规则：同「题号」的图（文件名带 <code>题1/题2…</code>）自动归为一题；其余按文件名时间（微信另存为自动带）两两配对，单张图单独成条。</p>
      <label class="bi-guide-skip"><input type="checkbox" id="bi-guide-skip"> 下次直接选择文件夹（不再显示本引导）</label>
    `, `
      <button class="btn btn-ghost" data-close>取消</button>
      <button class="btn btn-primary" id="bi-guide-go">选择文件夹开始</button>
    `), { lock: true });
    bindModalEvents();
    document.getElementById('bi-guide-go').onclick = () => {
      if (document.getElementById('bi-guide-skip').checked) localStorage.setItem(BULK_GUIDE_KEY, '1');
      UI.closeModal();
      pickBulkFolder();
    };
  }

  // 标准流程 4 步（引导弹窗与预览弹窗共用）
  function bulkGuideStepsHTML() {
    return `<div class="bi-guide-body">
      <div class="bi-step"><b>① 学习前</b>：建文件夹 <code>2026-09-16-英语</code>（多科就建多个：<code>2026-09-16-英语</code>、<code>2026-09-16-专业课</code>）</div>
      <div class="bi-step"><b>② 刷题时</b>：每题截图发微信，用「另存为」存进当天文件夹（文件名自动带时间戳）；若一题有多张解析图，在文件名末尾补同一「题号」，如 <code>…题1-题目</code>、<code>…题1-解析1</code>、<code>…题1-解析2</code></div>
      <div class="bi-step"><b>③ 学习后</b>：选当天文件夹导入 → 科目/日期自动带出 → 错因默认其他（要改就改）→ 确认导入</div>
      <div class="bi-step"><b>④ 之后</b>：每条点「编辑」补真正的知识点关键词和关键一步</div>
    </div>`;
  }

  // 文件真实时间：优先文件名紧邻的时间戳(微信图片_20260915132316_xxx)，回退文件系统修改时间
  function fileTime(f) {
    const base = (f.name || '').replace(/\.[^.]+$/, '');
    // 时间戳段必须是被下划线/连字符/中文字符包围的连续数字，避免 MD5 乱串误配
    const m = base.match(/(?:^|[\u4e00-\u9fa5_\-])(\d{14})(?=[\u4e00-\u9fa5_\-]|$)/) ||
              base.match(/(?:^|[\u4e00-\u9fa5_\-])(\d{10,14})(?=[\u4e00-\u9fa5_\-]|$)/);
    if (m) {
      const s = m[1];
      const t = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
        +(s.slice(8, 10) || 0), +(s.slice(10, 12) || 0), +(s.slice(12, 14) || 0)).getTime();
      if (!isNaN(t)) return t;
    }
    return (f.lastModified || 0);
  }

  function pickBulkFolder() {
    UI.pickFiles({ folder: true }, (files, filtered) => {
      if (!files.length) {
        Toast.show(filtered ? '所选均为非图片或超过 12MB 的文件' : '未选择图片', 'warn');
        return;
      }
      files.sort((a, b) => fileTime(a) - fileTime(b));
      const folderName = folderNameFrom(files);
      const meta = parseFolderMeta(folderName);
      const pairs = groupByQmark(files, meta);
      showBulkPreview(pairs, filtered, meta);
    });
  }

  // 题号键：从文件名提取「题N」作为同一题的分组键（如 微信图片_..._题1-题目 -> 题1）;无则 null
  function qmark(f) {
    const base = (f.name || '').replace(/\.[^.]+$/, '');
    const m = base.match(/(题\d+|T\d+)/i);
    return m ? m[1] : null;
  }

  // 题号优先：同「题N」的图(>=2张)归为一题；其余按文件时间两两配对兜底
  function groupByQmark(files, meta) {
    const marks = files.map(qmark);
    const counts = {};
    marks.forEach(p => { if (p) counts[p] = (counts[p] || 0) + 1; });
    const used = new Array(files.length).fill(false);
    const mk = imgs => ({ imgs, subject: meta.subject, title: folderNameFrom(files), errorType: 'other' });
    const pairs = [];
    files.forEach((f, i) => {
      const p = marks[i];
      if (p && counts[p] >= 2 && !used[i]) {
        const group = [];
        files.forEach((_, j) => {
          if (p === marks[j] && !used[j]) { used[j] = true; group.push(files[j]); }
        });
        group.sort((a, b) => fileTime(a) - fileTime(b));
        pairs.push(mk(group));
      }
    });
    const orphan = files.filter((_, i) => !used[i]);
    for (let i = 0; i < orphan.length; i += 2) pairs.push(mk(orphan.slice(i, i + 2)));
    return pairs;
  }

  // 从 webkitRelativePath 取文件夹名（如 习题1）；多选无路径时回退空
  function folderNameFrom(files) {
    for (const f of files) {
      const rel = f.webkitRelativePath || '';
      const seg = rel.split('/');
      if (seg.length > 1 && seg[0]) return seg[0];
    }
    return '';
  }

  // 文件夹名识别科目与日期（标准流程：YYYY-MM-DD-科目，如 2026-09-16-英语）；识别不到回退 math/空，不拦截
  function parseFolderMeta(name) {
    const n = (name || '').toLowerCase();
    const subject = /英语|english/.test(n) ? 'english'
      : /政治|politics|zhengzhi/.test(n) ? 'political'
      : /专业|zhuanye/.test(n) ? 'pro'
      : /数学|math/.test(n) ? 'math'
      : 'math';
    const m = n.match(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/);
    const date = m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : '';
    return { subject, date };
  }

  function showBulkPreview(pairs, filtered, meta) {
    let tempUrls = [];
    function revokeAll() { tempUrls.forEach(u => URL.revokeObjectURL(u)); tempUrls = []; }

    function renderPreview() {
      revokeAll();
      const subjectOpts = cur => SUBJECTS.map(s => `<option value="${s.key}" ${s.key === cur ? 'selected' : ''}>${s.name}</option>`).join('');
      const etOpts = cur => ERROR_TYPES.map(t => `<option value="${t.key}" ${t.key === cur ? 'selected' : ''}>${t.label}</option>`).join('');
      const metaName = SUBJECTS.find(s => s.key === meta.subject)?.name || '';
      const metaParts = [];
      if (meta.date) metaParts.push(`日期 ${meta.date}`);
      if (meta.subject !== 'math') metaParts.push(`科目 ${metaName}`);
      const metaTip = metaParts.length
        ? `<span class="ok">已识别：${metaParts.join(' · ')}</span>`
        : `<span class="warn">未识别到日期/科目，请手动设置（推荐文件夹名：2026-09-16-英语）</span>`;
      UI.openModal(UI.modalShell('批量导入错题', `
        <details class="bi-guide">
          <summary>使用流程（每天这样，一次导入全搞定）▾</summary>
          ${bulkGuideStepsHTML()}
        </details>
        <p class="modal-msg">共 ${pairs.length} 条。同「题号」的图自动归为一题（可含 1 张题目 + 多张解析）；其余按时间两两配对，单张图单独成条。配对与添加时间优先取文件名时间戳（微信「另存为」自动带，如 <code>微信图片_20260915132316_xxx.png</code>）${filtered ? `<br><span class="text-danger">已跳过 ${filtered} 个非图片/超过 12MB 的文件。</span>` : ''}</p>
        <div class="bi-meta">${metaTip}</div>
        <div class="bi-bulkbar"><span class="bi-bulkbar-label">全部设为科目：</span>${SUBJECTS.map(s => `<button type="button" class="btn btn-sm btn-ghost" data-bisubject="${s.key}">${s.name}</button>`).join('')}</div>
        ${pairs.map((p, i) => `
          <div class="bi-item">
            <div class="bi-head">
              <span class="chip chip-sub">第 ${i + 1} 条 · ${p.imgs.length > 2 ? `${p.imgs.length} 张图` : p.imgs.length > 1 ? '题+答' : '单图'}</span>
              <select class="select bi-subject" data-idx="${i}">${subjectOpts(p.subject)}</select>
              <select class="select bi-et" data-idx="${i}">${etOpts(p.errorType)}</select>
              <input class="input bi-title" data-idx="${i}" value="${esc(p.title)}" placeholder="知识点标题（可留空）">
              <button class="btn btn-icon btn-danger-ghost btn-sm" data-remove="${i}" title="移除该条">${UI.icon('trash', 15)}</button>
            </div>
            <div class="bi-imgs">${p.imgs.map(f => `<img class="bi-img" src="${URL.createObjectURL(f)}" alt="">`).join('')}</div>
          </div>`).join('')}
        <div class="bi-sum">共 ${pairs.length} 条 · 确认后仅新增写入错题簿，不影响已有数据</div>
      `, `
        <button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="bi-ok">确认导入 ${pairs.length} 条</button>
      `), { lock: true, lg: true });
      tempUrls = Array.from(document.querySelectorAll('.bi-img')).map(img => img.src);
      // 取消：先释放临时预览 URL 再关弹窗（覆盖 bindModalEvents 默认绑定）
      document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { revokeAll(); UI.closeModal(); });
      // 一键全部设为某科目
      document.querySelectorAll('[data-bisubject]').forEach(b => b.onclick = () => {
        document.querySelectorAll('.bi-subject').forEach(s => { s.value = b.getAttribute('data-bisubject'); });
      });
      // 移除条目：先读回已编辑的科目/标题再删，避免重渲染丢修改
      document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
        collectEdits(pairs);
        pairs.splice(Number(b.getAttribute('data-remove')), 1);
        renderPreview();
      });
      document.getElementById('bi-ok').onclick = () => {
        collectEdits(pairs);
        runBulkImport(pairs, revokeAll);
      };
    }
    renderPreview();
  }

  function collectEdits(pairs) {
    const sels = Array.from(document.querySelectorAll('.bi-subject'));
    const ets = Array.from(document.querySelectorAll('.bi-et'));
    const titles = Array.from(document.querySelectorAll('.bi-title'));
    pairs.forEach((p, i) => {
      if (sels[i]) p.subject = sels[i].value;
      if (ets[i]) p.errorType = ets[i].value;
      if (titles[i]) p.title = titles[i].value.trim();
    });
  }

  async function runBulkImport(pairs, revokeAll) {
    const okBtn = document.getElementById('bi-ok');
    okBtn.disabled = true;
    const total = pairs.length;
    let done = 0;
    for (const p of pairs) {
      okBtn.textContent = `导入中 ${done + 1}/${total}…`;
      const ids = [];
      for (const f of p.imgs) {
        const id = 'img_' + uid();
        await Store.saveImage(id, f);
        const thumb = await makeThumb(f);
        if (thumb) await Store.saveThumb(id, thumb);
        ids.push(id);
      }
      // created 取题目图真实时间（优先文件名时间戳，回退文件系统时间），保证还原做题顺序
      const ts = (p.imgs[0] && fileTime(p.imgs[0])) || Date.now();
      Controller.addWrongQuestion({
        subject: p.subject, title: p.title,
        errorTypes: [p.errorType || 'other'], customError: '', keyStep: '',
        images: ids, created: ts, updated: ts
      });
      done++;
    }
    revokeAll();
    UI.closeModal();
    render();
    Toast.show(`已导入 ${total} 条错题`);
  }

  function openForm(id) {
    const s = Controller.getState();
    const existing = id ? s.wrongQuestions.find(x => x.id === id) : null;
    const sel = existing || {};
    const sql = sel.errorTypes || [];
    const subjectOpts = SUBJECTS.map(x => `<option value="${x.key}" ${x.key === sel.subject ? 'selected' : ''}>${x.name}</option>`).join('');
    const typeChips = ERROR_TYPES.map(t => `
      <button type="button" class="radio-chip et-chip" data-et="${t.key}" data-label="${esc(t.label)}">${esc(t.label)}</button>`).join('');

    UI.openModal(UI.modalShell(existing ? '编辑错题' : '收录错题', `
      <div class="field"><label>科目</label>
        <select id="w-subject" class="select">${subjectOpts}</select></div>
      <div class="field"><label>① 题目·知识点（题干关键词，不抄全题）</label>
        <input id="w-title" class="input" value="${esc(sel.title || '')}" placeholder="例：泰勒展开求极限">
      </div>
      <div class="field"><label>② 我错在哪（可多选）</label>
        <div class="radio-row" id="w-types">${typeChips}</div>
        <input id="w-custom" class="input mt-1" style="${sel.customError ? '' : 'display:none'}"
          value="${esc(sel.customError || '')}" placeholder="自定义错误原因（当选择“其他”时生效）"></div>
      <div class="field"><label>③ 关键一步（正确路径中最容易断掉的那步）</label>
        <textarea id="w-step" class="textarea" placeholder="说明这题最关键的一步怎么走">${esc(sel.keyStep || '')}</textarea></div>
      <div class="field"><label>题目图片（可多张）</label>
        <div class="imgs" id="w-imglist"></div>
        <button class="btn btn-soft btn-sm mt-2" type="button" id="w-addimg">${UI.icon('camera', 15)} 上传/拍照题目图片</button></div>
    `, existing ? `
        <button class="btn btn-danger-soft" id="w-del">删除</button>
        <span class="grow"></span>
        <button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="w-save">保存</button>`
      : `
        <button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="w-save">保存</button>`), { lock: true });
    bindModalEvents();

    // 错误类型多选
    let chosen = sql;
    const chips = Array.from(document.querySelectorAll('.et-chip'));
    const customInput = document.getElementById('w-custom');
    function syncChips() {
      chips.forEach(c => {
        const k = c.getAttribute('data-et');
        c.classList.toggle('selected', chosen.includes(k));
      });
      customInput.style.display = (chosen.includes('other') || (document.getElementById('w-custom').value.trim())) ? '' : 'none';
    }
    chips.forEach(c => c.onclick = () => {
      const k = c.getAttribute('data-et');
      if (chosen.includes(k)) chosen = chosen.filter(x => x !== k);
      else chosen = chosen.concat(k);
      syncChips();
    });
    syncChips();

    // 图片
    let newImgs = (sel.images || []).slice();
    const imgList = document.getElementById('w-imglist');
    function renderImgs() {
      imgList.innerHTML = newImgs.map(UI.thumbHTML).join('');
      UI.hydrateThumbs(imgList);
    }
    renderImgs();
    imgList.onclick = (e) => {
      const d = e.target.closest('[data-del]');
      if (d) { newImgs = newImgs.filter(x => x !== d.getAttribute('data-del')); renderImgs(); }
    };
    document.getElementById('w-addimg').onclick = () => UI.pickImages(ids => { newImgs = newImgs.concat(ids); renderImgs(); });

    document.getElementById('w-save').onclick = () => {
      const title = document.getElementById('w-title').value.trim();
      if (!title && !newImgs.length) { Toast.show('请填写知识点或上传图片', 'warn'); return; }
      const data = {
        subject: document.getElementById('w-subject').value,
        title,
        errorTypes: chosen,
        customError: chosen.includes('other') ? document.getElementById('w-custom').value.trim() : '',
        keyStep: document.getElementById('w-step').value.trim(),
        images: newImgs
      };
      if (existing) Controller.updateWrongQuestion(existing.id, data);
      else Controller.addWrongQuestion(data);
      UI.closeModal(); render(); Toast.show('已保存');
    };
    if (existing) {
      document.getElementById('w-del').onclick = () => {
        UI.closeModal();
        ((existing.images) || []).forEach(UI.releaseImage);
        Controller.deleteWrongQuestion(existing.id); render(); Toast.show('已删除');
      };
    }
  }

  function render() {
    shown = PAGE;
    const s = Controller.getState();
    const all = sortWrong(Object.values(s.wrongQuestions));
    const total = all.length;
    const permanent = all.filter(w => w.permanent).length;
    const dueCount = Controller.reviewDueCount();

    el.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="ico">${UI.icon('pencil', 15)}</span>错题簿 <span class="chip">共 ${total} 题</span> <span class="chip chip-err">永久 ${permanent}</span></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" data-bulkimport>${UI.icon('folder', 15)} 批量导入</button>
          <button class="btn btn-primary" data-add>${UI.icon('plus', 15)} 收录错题</button>
        </div>
      </div>

      <div class="tab-row">
        <button class="tab-btn ${tab === 'review' ? 'active' : ''}" data-tab="review">${UI.icon('clock', 15)} 待复习 ${dueCount ? `<span class="tab-num due">${dueCount}</span>` : ''}</button>
        <button class="tab-btn ${tab === 'all' ? 'active' : ''}" data-tab="all">${UI.icon('list', 15)} 全部错题 <span class="tab-num">${total}</span></button>
        <button class="tab-btn ${tab === 'rank' ? 'active' : ''}" data-tab="rank">${UI.icon('trophy', 15)} 排行榜</button>
      </div>
      <div id="tabBody"></div>`;

    const body = el.querySelector('#tabBody');
    if (tab === 'review') renderReviewTab(body);
    else if (tab === 'rank') renderRankTab(body);
    else renderAllTab(body);
  }

  function renderAllTab(body) {
    const weak = Controller.weakPointStats();
    const typeTotal = Object.values(weak).reduce((a, b) => a + b, 0);
    const typeMax = Math.max(1, ...Object.values(weak));

    body.innerHTML = `
      <div class="card mt-2" id="weakPanel">
        <div class="card-title mb-sm"><span class="ico">${UI.icon('target', 15)}</span>薄弱点统计 <span class="chip">按「我错在哪」归因</span></div>
        ${ERROR_TYPES.map(t => {
          const cnt = weak[t.key];
          return `
          <div class="mini-bar" data-ftype="${t.key}">
            <span class="small" style="width:72px">${esc(t.label)}</span>
            <div class="bar-track"><i style="width:${cnt ? Math.round(cnt / typeMax * 100) : 0}%;background:${cnt === typeMax && cnt ? '#e46a6e' : 'var(--color-primary)'}"></i></div>
            <span class="bar-num bold">${cnt}</span>
          </div>`;
        }).join('')}
      </div>

      <div class="filter-bar mt-2">
        <span class="small muted">科目：</span>
        ${[['all','全部'], ...SUBJECTS.map(s => [s.key, s.name])].map(([k, n]) =>
          `<button class="chip ${k === filterSubject ? 'chip-sub' : ''}" data-fsub="${k}" style="cursor:pointer">${n}</button>`).join('')}
        <span class="small muted" style="margin-left:8px">掌握度：</span>
        ${[['all','全部'],['undone','未掌握'],['recur','复发中'],['mastered','已掌握'],['permanent','永久保留']].map(([k, n]) =>
          `<button class="chip ${k === filterStatus ? 'chip-sub' : ''}" data-fstat="${k}" style="cursor:pointer">${n}</button>`).join('')}
      </div>
      <div class="search-row mt-2">
        <input class="input" data-search type="search"
          placeholder="搜索知识点 / 错误类型 / 关键一步 / 自定义原因" value="${esc(filterKeyword)}">
      </div>
      <div class="small muted mb-2">搜索匹配题目知识点、我错在哪、关键一步；点击上方错误类型条可按该类筛错题</div>

      <div class="sort-row mt-2">
        <span class="small muted">排序：</span>
        <button class="chip ${sortBy === 'update' ? 'chip-sub' : ''}" data-sort="update" style="cursor:pointer">最近操作</button>
        <button class="chip ${sortBy === 'created' ? 'chip-sub' : ''}" data-sort="created" style="cursor:pointer">按添加时间</button>
        <span class="grow" style="flex:1"></span>
        <button class="chip" data-sortdir style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">${sortDir === 'asc'
          ? `<svg class="ico-svg" style="transform:rotate(180deg)" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-more"></use></svg>`
          : UI.icon('more', 12)} ${sortDir === 'asc' ? '最早在前' : '最新在前'}</button>
      </div>

      <div id="wrongCards"></div>`;
    refreshList();
  }

  function wrongCard(w) {
    const subjectName = SUBJECT_MAP[w.subject] ? SUBJECT_MAP[w.subject].name : '';
    const typeNames = (w.errorTypes || []).map(t => ERROR_TYPE_MAP[t] || t).join(' / ');
    const fullType = [typeNames, w.customError].filter(Boolean).join(' / ');
    return `
      <div class="wrong-card">
        <div class="wc-top">
          <span class="chip chip-sub">${esc(subjectName)}</span>
          ${w.permanent ? `<span class="chip chip-err">${UI.icon('flag', 13)} 永久保留</span>` : ''}
          ${!w.permanent && (w.reviewCount || 0) >= 3 ? `<span class="chip chip-ok">${UI.icon('check', 13)} 已掌握</span>` : ''}
          <span class="chip ${'sd-' + w.subject}"></span>
          <span class="wc-time" title="添加时间（按微信图时间）">${UI.icon('calendar', 15)} ${absTime(w.created || w.updated)}</span>
          <div class="grow"></div>
          <span class="recur ${w.recurCount >= 3 ? 'danger' : ''}">${UI.icon('repeat', 13)} ${w.recurCount}</span>
          <button class="btn btn-icon btn-ghost btn-sm" data-edit="${esc(w.id)}">${UI.icon('pencil', 15)}</button>
          <button class="btn btn-icon btn-danger-ghost btn-sm" data-del="${esc(w.id)}">${UI.icon('trash', 15)}</button>
        </div>

        <div class="wc-title">${w.title ? esc(w.title) : '<span class="muted small">（未填知识点）</span>'}</div>

        <div class="wc-grid">
          <div class="wc-field"><span class="k">我错在哪</span>
            <span class="v">${fullType ? esc(fullType) : '<span class="muted small">–</span>'}</span></div>
          <div class="wc-field"><span class="k">关键一步</span>
            <span class="v">${w.keyStep ? esc(w.keyStep) : '<span class="muted small">–</span>'}</span></div>
        </div>

        ${(() => {
          const lw = lastWrongReason(w);
          if (!lw) return '';
          const rk = (lw.reasonKey && ERROR_TYPE_MAP[lw.reasonKey]) ? ERROR_TYPE_MAP[lw.reasonKey] : (lw.reasonKey || '');
          const s = [rk, lw.reasonText || ''].filter(Boolean).join(' · ');
          return `<div class="wc-field rv-reason-field"><span class="k">${UI.icon('clock', 12)} 再错错因</span><span class="v"><b>${esc(s)}</b></span></div>`;
        })()}

        ${(w.images && w.images.length) ? `<div class="imgs">${w.images.map(b => `<img class="img-thumb" data-oid="${esc(b)}" data-src="">`).join('')}</div>` : ''}
        ${historyHTML(w)}

        <div class="mt-2 flex-between">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" data-review="${esc(w.id)}">${UI.icon('review', 15)} 复习</button>
            <button class="btn btn-danger-soft btn-sm" data-bump="${esc(w.id)}">${UI.icon('repeat', 15)} 再错 +1</button>
          </div>
          <span class="small muted">${reviewStatusText(w)}</span>
        </div>
      </div>`;
  }

  return { mount, render };
})();
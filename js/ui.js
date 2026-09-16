/* ===== ui.js =====
   视图共享助手：弹窗、图片管理、文件选择转图片 */

'use strict';

const UI = (() => {
  // ---- 线性描边图标（引用 index.html 内联 sprite，Lucide 风格）----
  function icon(name, size = 16) {
    return `<svg class="ico-svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }
  // ---- 缩略图对象URL缓存：避免重复读库，带上限、超限释放最旧 ----
  const urlCache = new Map(); // id -> { url }
  const URL_CACHE_MAX = 600;
  function cacheURL(id, blob) {
    URL.revokeObjectURL(urlCache.get(id) && urlCache.get(id).url);
    const url = URL.createObjectURL(blob);
    urlCache.set(id, { url });
    while (urlCache.size > URL_CACHE_MAX) {
      const oldest = urlCache.keys().next().value;
      URL.revokeObjectURL(urlCache.get(oldest).url);
      urlCache.delete(oldest);
    }
    return url;
  }
  function releaseImage(id) {
    const rec = urlCache.get(id);
    if (rec) { URL.revokeObjectURL(rec.url); urlCache.delete(id); }
  }
  // 优先缩略图，无缩略图（历史数据/旧备份）回退原图
  function thumbURL(id) {
    const rec = urlCache.get(id);
    if (rec) return Promise.resolve(rec.url);
    return Store.getThumb(id).then(b => b || Store.getImage(id))
      .then(blob => blob ? cacheURL(id, blob) : '');
  }

  // ---- 弹窗 ----
  function openModal(html, opts = {}) {
    const mask = document.getElementById('modalMask');
    mask.innerHTML = `
      <div class="modal ${opts.lg ? 'modal-lg' : ''}">
        ${html}
      </div>`;
    mask.hidden = false;
    document.body.style.overflow = 'hidden';
    mask.onclick = (e) => { if (e.target === mask && !opts.lock) closeModal(); };
  }
  function closeModal() {
    const mask = document.getElementById('modalMask');
    const modal = mask.querySelector('.modal');
    if (modal) {
      // 退出动画：WAAPI 反向 160ms；若动画期间已被新弹窗替换则不再清理
      modal.animate([
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(8px) scale(0.98)' }
      ], { duration: 160, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }).onfinish = () => {
        if (!mask.contains(modal)) return;
        mask.hidden = true;
        mask.innerHTML = '';
        document.body.style.overflow = '';
      };
    } else {
      mask.hidden = true;
      mask.innerHTML = '';
      document.body.style.overflow = '';
    }
  }

  // ---- 进度弹窗（导出/导入等长任务反馈，REQ-20260916-004）----
  // 弹窗锁定不可关闭；任务结束（含失败路径）必须调用 close()。
  // 返回 { update(pct, msg) 确定进度 0~100 | indet(msg) 不确定进度 | close() }
  function progressModal(title) {
    openModal(modalShell(esc(title), `
      <p class="modal-msg" id="progText">准备中…</p>
      <div class="progress mt-2 indet"><i id="progBar"></i></div>
      <p class="small muted mt-1" id="progPct">&nbsp;</p>`, ''), { lock: true });
    bindModalEvents();
    const bar = document.getElementById('progBar');
    const text = document.getElementById('progText');
    const pct = document.getElementById('progPct');
    const wrap = bar.parentElement;
    return {
      update(p, msg) {
        const v = Math.max(0, Math.min(100, Math.round(p)));
        wrap.classList.remove('indet');
        bar.style.width = v + '%';
        pct.textContent = v + '%';
        if (msg) text.textContent = msg;
      },
      indet(msg) {
        wrap.classList.add('indet');
        bar.style.width = '';
        pct.textContent = '…';
        if (msg) text.textContent = msg;
      },
      close() { closeModal(); }
    };
  }

  // 自定义确认弹窗（替换原生 confirm）：opts = { title, message, okText, danger, onOk }
  function confirm(opts) {
    const okText = opts.okText || '删除';
    const danger = opts.danger !== false;
    openModal(modalShell(opts.title || '确认操作', `<p class="modal-msg">${opts.message}</p>`,
      `<button class="btn btn-ghost" data-close>取消</button>
       <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${okText}</button>`), { lock: true });
    bindModalEvents();
    document.getElementById('confirm-ok').onclick = () => { UI.closeModal(); if (opts.onOk) opts.onOk(); };
  }

  function modalShell(title, bodyHtml, footHtml) {
    return `
      <div class="modal-head">
        <div class="modal-title">${title}</div>
        <button class="btn btn-icon btn-ghost" data-close>${icon('x', 16)}</button>
      </div>
      ${bodyHtml}
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}`;
  }
  // 关闭按钮绑定依赖该 mask 已渲染后调用

  // ---- 图片：生成缩略图字符串（用于模板字符串），data-oid 由事件委托挂载 ----
  function thumbHTML(blobId) {
    return `<div class="img-wrap" data-oid="${esc(blobId)}">
      <img class="img-thumb" data-oid="${esc(blobId)}" data-src="">
      <button class="img-del" data-del="${esc(blobId)}" title="删除">${icon('x', 11)}</button>
    </div>`;
  }

  // ---- 文件选择 => Blob -> IndexedDB，返回 blobId ----
  function pickImages(cb, single) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (!single) input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      const ids = [];
      for (const f of files) {
        if (!f.type.startsWith('image/')) { Toast.show('只能选择图片文件', 'warn'); continue; }
        if (f.size > 12 * 1024 * 1024) { Toast.show('单张图片过大（>12MB）', 'warn'); continue; }
        const id = 'img_' + uid();
        await Store.saveImage(id, f);
        // 同步生成缩略图（压缩到小尺寸），列表加载用缩略图大幅降内存
        const thumb = await makeThumb(f);
        if (thumb) await Store.saveThumb(id, thumb);
        ids.push(id);
      }
      cb(ids);
    };
    input.click();
  }

  // ---- 文件选择 => 原始 File 数组（不写库）：供批量导入等「先预览后落库」场景 ----
  // opts: { folder: 是否选整个文件夹(webkitdirectory), single: 是否单选 }
  // cb(files, filtered)：files=有效图片（已过滤非图片/超12MB），filtered=被过滤数量
  function pickFiles(opts, cb) {
    const o = opts || {};
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (!o.single) input.multiple = true;
    if (o.folder && 'webkitdirectory' in input) input.setAttribute('webkitdirectory', '');
    input.onchange = () => {
      let filtered = 0;
      const files = Array.from(input.files || []).filter(f => {
        if (!f.type.startsWith('image/')) { filtered++; return false; }
        if (f.size > 12 * 1024 * 1024) { filtered++; return false; }
        return true;
      });
      input.remove();
      cb(files, filtered);
    };
    input.addEventListener('cancel', () => input.remove());
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
  }

  async function hydrateThumbs(root) {
    const imgs = root.querySelectorAll('img.img-thumb');
    for (const img of imgs) {
      if (img.dataset.src) continue;
      const oid = img.getAttribute('data-oid');
      if (!oid) continue;
      const cached = urlCache.has(oid);
      const url = await thumbURL(oid);
      if (url) {
        img.dataset.src = 'x';
        // 首次从库读取才淡入，缓存命中直接显示不闪动
        if (!cached) img.classList.add('thumb-in');
        img.src = url;
      }
    }
  }

  // 点开看原图：列表只放缩略图，点击时才读原图放大
  async function lightboxById(oid) {
    if (!oid) return;
    let blob = null;
    try { blob = await Store.getImage(oid); } catch (e) { /* ignore */ }
    if (blob) lightbox(URL.createObjectURL(blob));
    else Toast.show('图片不存在', 'warn');
  }

  function lightbox(src) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${esc(src)}" alt="查看大图">`;
    box.onclick = () => box.remove();
    document.body.appendChild(box);
  }

  // ---- 外观双态：light=浅色 / dark=深色（REQ-010 日蚀式开关）----
  const THEME_META = { light: '#4f7cf7', dark: '#101319' };
  function applyTheme(mode) {
    mode = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = mode;
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', THEME_META[mode]));
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.classList.toggle('dark', mode === 'dark');
      b.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
    });
  }

  // ---- 日蚀式月亮如意开关（天空×日月×云视差×星星）----
  // 种子随机：保证两次渲染/双端实例的星星分布稳定，不闪变
  function seedRand(seed) {
    let s = (seed % 2147483647) || 1; if (s < 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  function starHTML(rng, count, compact) {
    let out = '';
    for (let i = 0; i < count; i++) {
      // 大小混合：约 1/3 四角星芒（大星）+ 小圆点
      const spark = rng() > 0.68;
      // 位置：摊开整条夜空（右侧给旋钮留白），桌面更宽、手机收窄
      const leftMax = compact ? 56 : 72;
      const left = (6 + rng() * (leftMax - 6)).toFixed(1);
      const top = (10 + rng() * 76).toFixed(1);
      const sz = (spark ? 6.5 + rng() * 2.5 : 1.8 + rng() * 1.6).toFixed(1);
      // 风吹入场：统一从左侧吹来（起点在落点左方），上下仅小幅错开
      const dist = compact ? 16 + rng() * 18 : 28 + rng() * 36;
      const ex = (-dist).toFixed(1);
      const ey = ((rng() - 0.5) * 12).toFixed(1);
      // 顺风起伏：飞行途中轻微上下飘，像被风托着
      const by = ((rng() - 0.5) * 18).toFixed(1);
      // Follow-through：随风向右轻微越过落点，再被风放回
      const ox = (2.5 + rng() * 4.5).toFixed(1);
      const oy = ((rng() - 0.5) * 4).toFixed(1);
      // 与月亮同步：旋钮 0.5s ease-pop 从左滑到右（前快后慢），
      // 星星按横向位置换算同曲线时刻亮起——月亮扫到哪，星星就在哪现身
      const inDel = (Math.pow(+left / 100, 2.5) * 0.5 + 0.04 + rng() * 0.05).toFixed(2);
      const inDur = (0.55 + rng() * 0.25).toFixed(2);
      // 落位后 Float：X/Y 各自独立周期与相位（失重漂移）
      const flX = (0.8 + rng() * 1.6).toFixed(1);
      const flY = (1.2 + rng() * 2.4).toFixed(1);
      const fxDur = (3.2 + rng() * 2.2).toFixed(2);
      const fxPha = (rng() * 4).toFixed(2);
      const fyDur = (4.4 + rng() * 2.8).toFixed(2);
      const fyPha = (rng() * 4).toFixed(2);
      // 闪烁：等本星入场结束后开始，大小星节奏各异
      const twDur = (2 + rng() * 2.4).toFixed(2);
      const twDel = (+inDel + +inDur + rng() * 1.6).toFixed(2);
      out += `<span class="tt-star" style="left:${left}%;top:${top}%;--tw-dur:${twDur}s;--tw-del:${twDel}s">`
           + `<span class="tt-move" style="--ex:${ex}px;--ey:${ey}px;--by:${by}px;--ox:${ox}px;--oy:${oy}px;--in-dur:${inDur}s;--in-del:${inDel}s">`
           + `<span class="tt-fx" style="--fl-x:${flX}px;--fx-dur:${fxDur}s;--fx-pha:${fxPha}s">`
           + `<span class="tt-fy" style="--fl-y:${flY}px;--fy-dur:${fyDur}s;--fy-pha:${fyPha}s">`
           + `<i class="tt-dot${spark ? ' spark' : ''}" style="--sz:${sz}px"></i></span></span></span></span>`;
    }
    return out;
  }
  function themeToggleHTML(mode = 'light', size = 'lg') {
    const dark = mode === 'dark';
    const rng = seedRand(size === 'sm' ? 7 : 19);
    const stars = starHTML(rng, size === 'sm' ? 9 : 16, size === 'sm');
    return `<button class="theme-toggle tt-${size} ${dark ? 'dark' : ''}" data-theme-toggle
              role="switch" aria-pressed="${dark}" aria-label="切换浅色/深色外观">
      <span class="tt-track">
        <i class="tt-cloud tt-cloud-far"></i>
        <i class="tt-cloud tt-cloud-mid"></i>
        <i class="tt-cloud tt-cloud-near"></i>
        <span class="tt-field">${stars}</span>
      </span>
      <span class="tt-knob">
        <span class="tt-moon">${icon('moon', 24)}</span>
      </span>
    </button>`;
  }

  // ---- 数字滚动（看板统计 am）：低频、首次入场触发 ----
  function countTo(el, to, dur = 600) {
    if (!el) return;
    if (typeof to !== 'number' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = String(to); return;
    }
    const start = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);            // ease-out，快起步慢落地
      el.textContent = String(Math.round(to * e));
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = String(to);
    }
    requestAnimationFrame(frame);
  }
  function animateCounts(el) {
    (el || document).querySelectorAll('[data-count]').forEach(n => {
      const t = n.getAttribute('data-count');
      const num = Number(t);
      countTo(n, Number.isFinite(num) ? num : t);
    });
  }

  return { openModal, closeModal, confirm, progressModal, icon, modalShell, thumbHTML, pickImages, pickFiles, hydrateThumbs, lightbox, lightboxById, releaseImage, applyTheme, themeToggleHTML, animateCounts };
})();

// 关闭弹窗（事件绑定辅助）
function bindModalEvents() {
  const mask = document.getElementById('modalMask');
  mask.querySelectorAll('[data-close]').forEach(b => b.onclick = () => UI.closeModal());
}
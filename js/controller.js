/* ===== controller.js =====
   业务状态中枢：持有内存态、读写 store、发布订阅事件。
   视图层只通过 controller 交换数据，不直接碰 localStorage/IndexedDB。 */

'use strict';

// 轻量 Toast（全局单例）
const Toast = (() => {
  let el, timer;
  function ensure() {
    if (!el) el = document.getElementById('toast');
    return el;
  }
  function show(msg, type) {
    const t = ensure();
    if (!t) return;
    t.textContent = msg;
    t.style.background = type === 'warn' ? '#e5484d' : '#242a38';
    t.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  return { show };
})();

const Controller = (() => {
  let state = Store.load(); // init() 前为默认占位，App_init 内 await init() 装载真实数据
  const listeners = {};

  // ---- 事件总线 ----
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  }
  // 启动装载：读 IndexedDB meta（含旧 localStorage 一次性迁移）+ 持久化申请（REQ-20260921-002）
  async function init() { state = await Store.init(); }
  function getState() { return state; }
  function persist() {
    const ok = Store.save(state);
    emit('change');
    return ok;
  }
  // 完全重载（导入后）
  function replace(newData) { state = newData; persist(); }

  // ---- 设置 ----
  function getSettings() { return state.settings; }
  function updateSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    persist();
  }

  // ---- 学习时长 ----
  function getStudyLog(dateStr) { return state.studyLogs[dateStr] || {}; }
  function logStudy(dateStr, subject, minutes) {
    if (!dateStr || !subject || !minutes || !Number.isFinite(minutes)) return;
    state.studyLogs[dateStr] = state.studyLogs[dateStr] || {};
    state.studyLogs[dateStr][subject] = Math.max(0, (state.studyLogs[dateStr][subject] || 0) + minutes);
    persist();
  }
  function todayStudyMinutes() {
    const log = getStudyLog(todayStr());
    return Object.values(log).reduce((a, b) => a + (b || 0), 0);
  }

  // ---- 任务 ----
  function addTask(task) {
    state.tasks.push(Object.assign({ id: uid(), done: false, createdAt: Date.now() }, task));
    persist();
  }
  function updateTask(id, patch) {
    const t = state.tasks.find(x => x.id === id);
    if (t) { Object.assign(t, patch); persist(); }
  }
  function deleteTask(id) {
    state.tasks = state.tasks.filter(x => x.id !== id);
    persist();
  }
  function toggleTask(id) {
    const t = state.tasks.find(x => x.id === id);
    if (t) { t.done = !t.done; persist(); }
  }

  // ---- 科目进度 ----
  function getSubject(subject) { return state.subjects[subject]; }
  function updateSubject(subject, patch) {
    if (!state.subjects[subject]) return;
    state.subjects[subject] = Object.assign({}, state.subjects[subject], patch);
    persist();
  }

  // ---- 真题 ----
  function addPaper(p) { state.pastPapers.push(Object.assign({ id: uid(), createdAt: Date.now() }, p)); persist(); }
  function updatePaper(id, patch) {
    const p = state.pastPapers.find(x => x.id === id);
    if (p) { Object.assign(p, patch); persist(); }
  }
  function deletePaper(id) { state.pastPapers = state.pastPapers.filter(x => x.id !== id); persist(); }

  // ---- 模考 ----
  function addMock(m) { state.mockExams.push(Object.assign({ id: uid(), createdAt: Date.now() }, m)); persist(); }
  function updateMock(id, patch) {
    const m = state.mockExams.find(x => x.id === id);
    if (m) { Object.assign(m, patch); persist(); }
  }
  function deleteMock(id) { state.mockExams = state.mockExams.filter(x => x.id !== id); persist(); }

  // ---- 资料库 ----
  function addMaterial(m) { state.materials.push(Object.assign({ id: uid(), tags: [], images: [], createdAt: Date.now() }, m)); persist(); }
  function updateMaterial(id, patch) {
    const m = state.materials.find(x => x.id === id);
    if (m) { Object.assign(m, patch); persist(); }
  }
  function deleteMaterial(id) {
    const m = state.materials.find(x => x.id === id);
    if (m && m.images) m.images.forEach(bid => Store.deleteImage(bid));
    state.materials = state.materials.filter(x => x.id !== id);
    persist();
  }

  // ---- 错题簿（核心）----
  // errorType 可多选（数组），含自定义
  function addWrongQuestion(w) {
    state.wrongQuestions.push(Object.assign({
      id: uid(), errorTypes: [], customError: '',
      keyStep: '', recurCount: 0, permanent: false,
      reviewCount: 0, lastReviewedAt: null, reviewHistory: [],
      images: [], created: Date.now(), updated: Date.now()
    }, w));
    persist();
  }
  function updateWrongQuestion(id, patch) {
    const w = state.wrongQuestions.find(x => x.id === id);
    if (w) {
      Object.assign(w, patch, { updated: Date.now() });
      // 复发 >= 3 自动永久保留
      if (w.recurCount >= 3) w.permanent = true;
      persist();
    }
  }
  function bumpWrong(id) { // 再错 +1
    const w = state.wrongQuestions.find(x => x.id === id);
    if (w) {
      w.recurCount = (w.recurCount || 0) + 1;
      w.reviewCount = 0; // 又做错：打断连续做对，「已掌握」随之解除
      if (w.recurCount >= 3) w.permanent = true;
      w.updated = Date.now();
      persist();
    }
  }
  function deleteWrongQuestion(id) {
    const w = state.wrongQuestions.find(x => x.id === id);
    if (w && w.images) w.images.forEach(bid => Store.deleteImage(bid));
    state.wrongQuestions = state.wrongQuestions.filter(x => x.id !== id);
    persist();
  }

  // ---- 薄弱点统计（按错误类型聚合）----
  function weakPointStats() {
    const map = Object.fromEntries(ERROR_TYPES.map(e => [e.key, 0]));
    state.wrongQuestions.forEach(w => {
      (w.errorTypes || []).forEach(t => { if (t in map) map[t]++; });
      // 自定义错误也计入 other
      if (w.customError) map.other++;
    });
    return map;
  }

  // ---- 错题复习与排行榜（F-08）----
  // 复习=重做：correct=true 做对→reviewCount+1；false 做错→recurCount+1、reviewCount 归零、≥3 永久保留
  // opts：{ elapsedSec 本次耗时秒, reasonKey 再错错因key, reasonText 再错错因自定义 }（REQ-007）
  function markReviewed(id, correct, opts) {
    const w = state.wrongQuestions.find(x => x.id === id);
    if (!w) return null;
    opts = opts || {};
    w.lastReviewedAt = Date.now();
    if (correct) {
      w.reviewCount = (w.reviewCount || 0) + 1;
    } else {
      w.recurCount = (w.recurCount || 0) + 1;
      w.reviewCount = 0;
      if (w.recurCount >= 3) w.permanent = true;
    }
    const entry = { at: w.lastReviewedAt, correct: !!correct };
    if (opts.elapsedSec != null) entry.elapsedSec = Math.max(1, Math.round(opts.elapsedSec));
    if (!correct) {
      if (opts.reasonKey) entry.reasonKey = opts.reasonKey;
      if (opts.reasonText) entry.reasonText = opts.reasonText;
    }
    w.reviewHistory = (w.reviewHistory || []).concat(entry);
    if (w.reviewHistory.length > REVIEW_HISTORY_MAX) {
      w.reviewHistory = w.reviewHistory.slice(-REVIEW_HISTORY_MAX);
    }
    w.updated = Date.now();
    persist();
    return { recurCount: w.recurCount, reviewCount: w.reviewCount, permanent: w.permanent };
  }

  // 今日已复习次数 = 今天 reviewHistory 条数总和（跨题累计，用于每日目标）
  function todayReviewedCount() {
    const t = todayStr();
    let n = 0;
    state.wrongQuestions.forEach(w => {
      (w.reviewHistory || []).forEach(h => {
        if (h && toDateStr(new Date(h.at)) === t) n++;
      });
    });
    return n;
  }

  // 智能复习队列：返回 { list(活动受理区), deferred(顺延), stabilized(稳定收纳), capSummary }
  // 排序：逾期天数大者优先 → 同逾期按到期时间早优先；稳定掌握题淡出。
  // dailyReviewCap：0=不限；负/空=自适应取近14天中位数；>0=固定每日受理数。
  function reviewDueQueue() {
    const now = Date.now();
    const intervalBase = state.settings.reviewBaseInterval;
    const all = state.wrongQuestions
      .map(w => ({ w, meta: reviewMeta(w, intervalBase) }))
      .filter(x => x.meta.due <= now)
      .sort((a, b) => (b.meta.overdueDays - a.meta.overdueDays) || (a.meta.due - b.meta.due));

    // 1) 分拣稳定掌握题
    const stable = [], rest = [];
    all.forEach(x => (isStabilized(x.w, intervalBase) ? stable : rest).push(x));

    // 2) 受限量
    const capUsed = state.settings.dailyReviewCap;
    const capVal = dailyCapValue(capUsed, state.wrongQuestions, intervalBase);
    let list = rest, deferred = [];
    if (capVal > 0 && rest.length > capVal) {
      list = rest.slice(0, capVal);
      deferred = rest.slice(capVal);
    }
    return {
      list,
      deferred,
      stabilized: stable,
      cap: capVal,
      capSummary: {
        total: all.length,
        shown: list.length,
        deferred: deferred.length,
        stabilized: stable.length
      }
    };
  }

  function reviewDueList() {
    return reviewDueQueue().list;
  }

  function reviewDueCount() {
    return reviewDueQueue().capSummary.total;
  }

  // 排行榜：按复发次数降序，次级按最近更新降序
  function ranking(limit = 10) {
    return state.wrongQuestions.slice()
      .sort((a, b) => (b.recurCount || 0) - (a.recurCount || 0) || (b.updated || 0) - (a.updated || 0))
      .slice(0, limit);
  }

  // ---- 备份：导出/导入 ----
  // 图片 Blob -> base64 dataURL 字符串（便于 JSON 序列化）
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(dataURL) {
    const [head, b64] = dataURL.split(',');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  // 让浏览器先绘制一帧再继续（同步大计算 JSON.parse/stringify 前刷新进度文字，REQ-20260916-004）
  function nextFrame() {
    return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  }

  async function exportAll() {
    // Chrome/Edge 桌面：流式 NDJSON 写盘（REQ-20260921-001），内存峰值≈单张图，数 GB 备份可承受
    if (window.showSaveFilePicker) {
      try {
        await exportStream();
      } catch (e) {
        console.error(e);
        Toast.show('导出失败，请重试', 'warn');
      }
      return;
    }
    // 降级：Firefox/Safari/手机端走 v1 整包 blob 下载（大数据量可能失败）
    Toast.show('当前浏览器不支持流式备份，建议使用 Chrome/Edge', 'warn');
    await exportBlob();
  }

  // ---- v2 流式导出：NDJSON（首行 meta + 每行一图），逐张读库逐行写盘 ----
  async function exportStream() {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: 'backup-' + todayStr() + '.jsonl',
        types: [{ description: '备份文件', accept: { 'application/json': ['.jsonl', '.json'] } }]
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 用户取消另存为，静默退出
      throw e;
    }
    const prog = UI.progressModal('导出备份');
    let w = null;
    try {
      const keys = await Store.imageKeys(); // 只取 key 列表，不把图片拉进内存
      const total = keys.length;
      if (!total) prog.update(5, '没有图片，正在打包数据…');
      w = await handle.createWritable();
      await w.write(JSON.stringify({ v: 2, createdAt: Date.now(), imagesTotal: total, data: state }) + '\n');
      for (let i = 0; i < total; i++) {
        prog.update(((i + 1) / (total + 1)) * 95, `正在写入图片 ${i + 1}/${total}`);
        const blob = await Store.getImage(keys[i]);
        if (blob instanceof Blob) {
          await w.write(JSON.stringify({ i: keys[i], d: await blobToDataURL(blob) }) + '\n');
        }
        // 非 Blob（异常脏数据）跳过
      }
      await w.close();
      w = null;
      // 记录本次导出时间（REQ-20260916-003 备份提醒）
      updateSettings({ lastExportAt: Date.now() });
      prog.close();
      Toast.show('备份已导出');
    } catch (e) {
      if (w) { try { await w.abort(); } catch (e2) { /* ignore */ } }
      prog.close();
      throw e;
    }
  }

  // ---- v1 整包导出（降级路径）：单根 JSON + blob 下载 ----
  async function exportBlob() {
    const prog = UI.progressModal('导出备份');
    try {
      // 只导出原图，跳过缩略图（t_ 前缀），备份更小、结构干净
      const originals = (await Store.allImages()).filter(([bid]) => !String(bid).startsWith('t_'));
      const total = originals.length;
      if (!total) prog.update(5, '没有图片，正在打包数据…');
      // 分段拼装 JSON：图片边转 base64 边写入 parts，不整体 stringify，
      // 避免超大字符串把内存撑爆（BUG-20260921-001）
      const parts = ['{"backup":true,"createdAt":' + Date.now() + ',"data":' + JSON.stringify(state) + ',"images":['];
      for (let i = 0; i < total; i++) {
        const [bid, blob] = originals[i];
        prog.update(((i + 1) / (total + 1)) * 85, `正在读取图片 ${i + 1}/${total}`);
        if (blob instanceof Blob) {
          const s = JSON.stringify([bid, await blobToDataURL(blob)]);
          parts.push((parts.length > 1 ? ',' : '') + s);
        }
        // 非 Blob（异常脏数据）跳过
        originals[i] = null; // 用完即释放 Blob 引用，降低内存占用
      }
      parts.push(']}');
      prog.indet('正在生成备份文件…');
      await nextFrame(); // 先绘制进度文字，再执行同步 Blob 组装
      const blob = new Blob(parts, { type: 'application/json' });
      parts.length = 0; // Blob 已拷贝数据，及时释放 base64 字符串
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'backup-' + todayStr() + '.json';
      document.body.appendChild(a); // 部分手机浏览器要求 a 在文档内才会触发下载
      a.click();
      a.remove();
      // 下载管理器可能延迟数秒才开始读取 blob，过早 revoke 会导致下载失败/
      // 降级成「访问 blob 链接」→ 无法访问此网站
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      // 记录本次导出时间（REQ-20260916-003 备份提醒）：不影响本次备份文件内容
      updateSettings({ lastExportAt: Date.now() });
      prog.close();
      Toast.show('备份已导出');
    } catch (e) {
      console.error(e);
      prog.close();
      Toast.show('导出失败，请重试', 'warn');
    }
  }

  // ---- 导入：流式逐行读，自动识别 v2（NDJSON）与 v1（单根 JSON 整包） ----
  async function importAll(file) {
    const prog = UI.progressModal('导入备份');
    try {
      prog.indet('正在解析备份文件…');
      await nextFrame(); // 先绘制进度文字，再开始流式读取
      const reader = file.stream().getReader();
      const dec = new TextDecoder('utf-8');
      let buf = '';
      let meta = null; // v2 首行
      let v1 = null;   // v1 整包（v1 文件无换行，整根即一行）
      let restored = 0, thumbSkipped = 0;
      async function restoreImage(bid, dataURL) {
        if (String(bid).startsWith('t_')) { thumbSkipped++; return; }
        const blob = dataURLToBlob(dataURL);
        await Store.saveImage(bid, blob);
        // 导入后补生成缩略图，保证跨设备/旧备份体验一致
        const thumb = await makeThumb(blob);
        if (thumb) await Store.saveThumb(bid, thumb);
        restored++;
      }
      async function handleLine(line) {
        if (!line) return;
        const obj = JSON.parse(line);
        if (obj && obj.v === 2 && obj.data) { meta = obj; return; }
        if (obj && obj.backup === true) { v1 = obj; return; }
        if (obj && typeof obj.i === 'string' && typeof obj.d === 'string' && obj.d.startsWith('data:')) {
          await restoreImage(obj.i, obj.d);
          if (meta) prog.update(10 + (restored / Math.max(1, meta.imagesTotal)) * 85,
            `正在恢复图片 ${restored}/${meta.imagesTotal}`);
          return;
        }
        // 无法识别的行：跳过（向前兼容未知字段）
      }
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          await handleLine(line);
        }
      }
      buf += dec.decode();
      if (buf) await handleLine(buf);

      if (v1) {
        // v1 旧备份：images 数组逐条恢复（原逻辑）
        if (Array.isArray(v1.images)) {
          const total = v1.images.length;
          let ok = 0;
          for (let i = 0; i < total; i++) {
            prog.update(((i + 1) / (total + 1)) * 90, `正在恢复图片 ${i + 1}/${total}`);
            const [bid, val] = v1.images[i];
            if (String(bid).startsWith('t_')) { thumbSkipped++; continue; }
            if (typeof val === 'string' && val.startsWith('data:')) {
              await restoreImage(bid, val);
              ok++;
            }
            // 非 dataURL（含旧版空对象）无法恢复，跳过
          }
          if (ok + thumbSkipped < total) Toast.show('部分旧备份图片无法恢复（已跳过）', 'warn');
        }
        prog.indet('正在写入数据…');
        await nextFrame();
        Controller.replace(Store.migrate(v1.data));
      } else if (meta) {
        prog.indet('正在写入数据…');
        await nextFrame();
        Controller.replace(Store.migrate(meta.data));
      } else {
        throw new Error('非备份文件');
      }
      prog.close();
      Toast.show('导入成功');
      emit('data-restored');
    } catch (e) {
      console.error(e);
      prog.close();
      Toast.show('导入失败：文件格式不正确', 'warn');
    }
  }

  return {
    on, emit, init, getState, replace, persist,
    getSettings, updateSettings,
    getStudyLog, logStudy, todayStudyMinutes,
    addTask, updateTask, deleteTask, toggleTask,
    getSubject, updateSubject,
    addPaper, updatePaper, deletePaper,
    addMock, updateMock, deleteMock,
    addMaterial, updateMaterial, deleteMaterial,
    addWrongQuestion, updateWrongQuestion, bumpWrong, deleteWrongQuestion,
    markReviewed, reviewDueList, reviewDueQueue, reviewDueCount, ranking, todayReviewedCount,
    weakPointStats,
    exportAll, importAll
  };
})();
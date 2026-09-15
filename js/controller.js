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
  let state = Store.load();
  const listeners = {};

  // ---- 事件总线 ----
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  }
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
    if (!dateStr || !subject || !(minutes > 0)) return;
    state.studyLogs[dateStr] = state.studyLogs[dateStr] || {};
    state.studyLogs[dateStr][subject] = (state.studyLogs[dateStr][subject] || 0) + minutes;
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

  // 到期未复习队列：按到期时间升序
  function reviewDueList() {
    const now = Date.now();
    const intervalBase = state.settings.reviewBaseInterval;
    return state.wrongQuestions
      .map(w => ({ w, meta: reviewMeta(w, intervalBase) }))
      .filter(x => x.meta.due <= now)
      .sort((a, b) => a.meta.due - b.meta.due);
  }

  function reviewDueCount() { return reviewDueList().length; }

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

  async function exportAll() {
    const rawImages = await Store.allImages();
    const images = [];
    for (const [bid, blob] of rawImages) {
      // 只导出原图，跳过缩略图（t_ 前缀），备份更小、结构干净
      if (String(bid).startsWith('t_')) continue;
      if (blob instanceof Blob) images.push([bid, await blobToDataURL(blob)]);
      // 非 Blob（异常脏数据）跳过
    }
    const payload = { backup: true, createdAt: Date.now(), data: state, images };
    const str = JSON.stringify(payload);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-' + todayStr() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    Toast.show('备份已导出');
  }

  async function importAll(json) {
    try {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      if (!parsed || !parsed.backup) throw new Error('非备份文件');
      // 导入图片：兼容新备份（仅原图）与旧备份（含 t_ 缩略图键，一律跳过，导入后统一重建缩略图）
      if (Array.isArray(parsed.images)) {
        let restored = 0, thumbSkipped = 0;
        for (const item of parsed.images) {
          const bid = item[0];
          const val = item[1];
          if (String(bid).startsWith('t_')) { thumbSkipped++; continue; }
          if (typeof val === 'string' && val.startsWith('data:')) {
            const blob = dataURLToBlob(val);
            await Store.saveImage(bid, blob);
            // 导入后补生成缩略图，保证跨设备/旧备份体验一致
            const thumb = await makeThumb(blob);
            if (thumb) await Store.saveThumb(bid, thumb);
            restored++;
          }
          // 非 dataURL（含旧版空对象）无法恢复，跳过
        }
        if (restored < parsed.images.length - thumbSkipped) {
          Toast.show('部分旧备份图片无法恢复（已跳过）', 'warn');
        }
      }
      Controller.replace(Store.migrate(parsed.data));
      Toast.show('导入成功');
      emit('data-restored');
    } catch (e) {
      console.error(e);
      Toast.show('导入失败：文件格式不正确', 'warn');
    }
  }

  return {
    on, emit, getState, replace, persist,
    getSettings, updateSettings,
    getStudyLog, logStudy, todayStudyMinutes,
    addTask, updateTask, deleteTask, toggleTask,
    getSubject, updateSubject,
    addPaper, updatePaper, deletePaper,
    addMock, updateMock, deleteMock,
    addMaterial, updateMaterial, deleteMaterial,
    addWrongQuestion, updateWrongQuestion, bumpWrong, deleteWrongQuestion,
    markReviewed, reviewDueList, reviewDueCount, ranking, todayReviewedCount,
    weakPointStats,
    exportAll, importAll
  };
})();
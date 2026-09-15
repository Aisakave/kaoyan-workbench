/* ===== store.js =====
   持久层抽象：localStorage 结构化数据 + IndexedDB 图片（Blob）
   版本迁移钩子、导出/导入、容错 */

'use strict';

const Store = (() => {
  const LS_KEY = 'kylc:data';
  const IDB_DB = 'kylc-images';
  const IDB_STORE = 'images';
  const CURRENT_VERSION = 2;

  // ---- 默认数据 ----
  function defaultData() {
    return {
      _version: CURRENT_VERSION,
      settings: {
        examDate: '2026-12-19',
        school: '',
        targetScore: null,
        dailyStudyMin: 0,      // 今日学习时长(分钟)，按日期结构存储，见 studyLogs
        dailyReviewGoal: 0,    // 每日复习目标(题数)，0=未设置（REQ-005）
        reviewBaseInterval: 3, // 错题复习基础间隔(天)，新题首次/做错后回到；0=收录即到期（REQ-006）
        theme: 'light'         // 外观：light=浅色 / dark=深色（REQ-010 双态）
      },
      studyLogs: { /* { '2026-09-15': { english:min, political:min, math:min, pro:min } } */ },
      tasks: [],
      subjects: {
        english:   { percent: 0, stage: '' },
        political: { percent: 0, stage: '' },
        math:      { percent: 0, stage: '' },
        pro:       { percent: 0, stage: '' }
      },
      pastPapers: [],
      mockExams: [],
      materials: [],
      wrongQuestions: []
    };
  }

  function migrate(data) {
    // 预留版本迁移钩子：未来 _version 增长时在此逐级升级
    if (!data || !data.settings) return defaultData();
    data.settings = Object.assign(defaultData().settings, data.settings);
    // REQ-010 三态改双态：历史 'auto'（跟随系统）一次性归为浅色
    if (data.settings.theme === 'auto') data.settings.theme = 'light';
    data.studyLogs = data.studyLogs || {};
    data.tasks = data.tasks || [];
    data.subjects = Object.assign({}, defaultData().subjects, data.subjects);
    data.pastPapers = data.pastPapers || [];
    data.mockExams = data.mockExams || [];
    data.materials = data.materials || [];
    data.wrongQuestions = (data.wrongQuestions || []).map(w => Object.assign({
      reviewCount: 0, lastReviewedAt: null, reviewHistory: []
    }, w));
    data._version = CURRENT_VERSION;
    return data;
  }

  // ---- localStorage 读/写 ----
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultData();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.error('load failed', e);
      return defaultData();
    }
  }
  function save(data) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        Toast.show('存储空间已满：请导出数据备份后清理', 'warn');
      } else {
        console.error('save failed', e);
      }
      return false;
    }
  }

  // ---- IndexedDB 封装（Promise）----
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);  // keyPath 由 put 时给定
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbTx(mode) {
    return idbOpen().then(db => {
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        resolve({ store, done: tx });
      });
    });
  }

  async function saveImage(blobId, blob) {
    const { store, done } = await idbTx('readwrite');
    store.put(blob, blobId);
    return done;
  }
  // 缩略图：与原图同库、独立键，便于原图/缩略图分开读写
  function thumbKey(blobId) { return 't_' + blobId; }
  async function saveThumb(blobId, blob) {
    const { store, done } = await idbTx('readwrite');
    store.put(blob, thumbKey(blobId));
    return done;
  }
  async function getThumb(blobId) {
    const { store } = await idbTx('readonly');
    return new Promise(resolve => {
      const req = store.get(thumbKey(blobId));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  async function getImage(blobId) {
    const { store } = await idbTx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(blobId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function deleteImage(blobId) {
    const { store, done } = await idbTx('readwrite');
    store.delete(blobId);
    store.delete(thumbKey(blobId));
    return done;
  }
  async function allImages() {
    const { store } = await idbTx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.openCursor();
      const out = [];
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { out.push([cur.key, cur.value]); cur.continue(); }
        else resolve(out);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // 供 controller 使用
  function nowMs() { return Date.now(); }

  return {
    LS_KEY, CURRENT_VERSION,
    defaultData, migrate, load, save,
    saveImage, saveThumb, getImage, getThumb, deleteImage, allImages
  };
})();
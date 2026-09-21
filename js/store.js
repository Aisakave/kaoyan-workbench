/* ===== store.js =====
   持久层抽象：IndexedDB 承载结构化数据（meta store）+ 图片（Blob）
   localStorage 仅作为一次性迁移源（REQ-20260921-002）、版本迁移钩子、导出/导入、容错 */

'use strict';

const Store = (() => {
  const LS_KEY = 'kylc:data';          // 旧版 localStorage 键：仅在迁移期读取，迁移成功后删除
  const IDB_DB = 'kylc-images';
  const IDB_STORE = 'images';
  const IDB_META = 'meta';             // v2：结构化数据 store（REQ-20260921-002）
  const META_STATE_KEY = 'state';
  const CURRENT_VERSION = 2;

  // ---- 默认数据 ----
  function defaultData() {
    return {
      _version: CURRENT_VERSION,
      settings: {
        examDate: '2027-12-18',
        school: '',
        targetScore: null,
        dailyStudyMin: 0,      // 今日学习时长(分钟)，按日期结构存储，见 studyLogs
        dailyReviewGoal: 0,    // 每日复习目标(题数)，0=未设置（REQ-005）
        reviewBaseInterval: 3, // 错题复习基础间隔(天)，新题首次/做错后回到；0=收录即到期（REQ-006）
        dailyReviewCap: -1,     // 每日复习受理上限：0=不限，-1=自适应(取近14天中位数)，>0=固定每日道数（REQ-016-002）
        theme: 'light',         // 外观：light=浅色 / dark=深色（REQ-010 双态）
        lastExportAt: null      // 最近一次成功导出备份的时间戳(ms)，null=从未导出（REQ-20260916-003 备份提醒）
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

  // ---- IndexedDB 封装（Promise）----
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);  // keyPath 由 put 时给定
        }
        if (!db.objectStoreNames.contains(IDB_META)) {
          db.createObjectStore(IDB_META);   // v2：结构化数据（REQ-20260921-002）
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbTx(mode, storeName = IDB_STORE) {
    return idbOpen().then(db => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
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
  // 仅取原图 key 列表（跳过 t_ 缩略图），不带 Blob 数据，几万条也很轻（REQ-20260921-001 流式导出用）
  async function imageKeys() {
    const { store } = await idbTx('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result.filter(k => !String(k).startsWith('t_')));
      req.onerror = () => reject(req.error);
    });
  }

  // ---- 结构化数据：meta store（REQ-20260921-002）----
  async function getMeta(key) {
    const { store } = await idbTx('readonly', IDB_META);
    return new Promise(resolve => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  async function putMeta(key, value) {
    const { store, done } = await idbTx('readwrite', IDB_META);
    store.put(value, key);
    return done;
  }

  let memState = null;

  // 应用启动时调用一次：装载 state（含旧 localStorage 一次性迁移）+ 申请持久化存储
  async function init() {
    let raw = null, fromLS = false;
    try { raw = await getMeta(META_STATE_KEY); } catch (e) { raw = null; }
    if (raw == null) {
      try {
        const lsRaw = localStorage.getItem(LS_KEY);
        if (lsRaw) { raw = JSON.parse(lsRaw); fromLS = true; }
      } catch (e) { raw = null; }
    }
    const data = (raw && typeof raw === 'object') ? migrate(raw) : defaultData();
    if (fromLS) {
      try {
        await putMeta(META_STATE_KEY, data);
        localStorage.removeItem(LS_KEY); // 迁移成功，消除双源歧义；失败则保留下次再试
      } catch (e) { console.error('migrate to IndexedDB failed', e); }
    }
    memState = data;
    // best-effort 持久化申请：降低磁盘紧张时被浏览器回收清空的风险（无弹窗，浏览器自行决定）
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
    return data;
  }

  // 同步读取内存态：init() 前返回默认数据占位，init() 后返回已装载的真实数据
  function load() { return memState || defaultData(); }

  // 保存：立即更新内存引用 + 异步落 IndexedDB（fire-and-forget，失败 Toast）
  function save(data) {
    memState = data;
    putMeta(META_STATE_KEY, data).catch(e => {
      console.error('save failed', e);
      Toast.show('保存失败：存储空间不足或被占用，请导出备份', 'warn');
    });
    return true;
  }

  // 供 controller 使用
  function nowMs() { return Date.now(); }

  return {
    CURRENT_VERSION,
    defaultData, migrate, init, load, save,
    saveImage, saveThumb, getImage, getThumb, deleteImage, allImages, imageKeys
  };
})();
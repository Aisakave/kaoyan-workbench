/* ===== utils.js =====
   工具：常量、日期、倒计时、时长、格式化、ID */

'use strict';

const SUBJECTS = [
  { key: 'english',   name: '英语', color: '#5aa9e6' },
  { key: 'political', name: '政治', color: '#e5533d' },
  { key: 'math',      name: '数学', color: '#35b96f' },
  { key: 'pro',       name: '专业课', color: '#f0a518' }
];

const SUBJECT_MAP = Object.fromEntries(SUBJECTS.map(s => [s.key, s]));

const PRIORITIES = {
  high: { label: '高', cls: 'tag-pri-hi' },
  mid:  { label: '中', cls: 'tag-pri-mid' },
  low:  { label: '低', cls: 'tag-pri-low' }
};

// 错误类型常量（错题簿·我错在哪）
const ERROR_TYPES = [
  { key: 'concept', label: '概念不清' },
  { key: 'calc',    label: '计算失误' },
  { key: 'reading', label: '审题漏条件' },
  { key: 'formula', label: '记错公式' },
  { key: 'method',  label: '方法没想到' },
  { key: 'time',    label: '时间不够' },
  { key: 'other',   label: '其他/自定义' }
];
const ERROR_TYPE_MAP = Object.fromEntries(ERROR_TYPES.map(e => [e.key, e.label]));

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad2(n) { return String(n).padStart(2, '0'); }

// 日期工具
function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDateStr(d);
}
function toDateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
// 距目标日天数（目标日在今天之后为正）
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = parseDate(dateStr);
  if (!target) return null;
  target.setHours(0,0,0,0);
  return Math.round((target - today) / 86400000);
}

// 相对日期文案
function dateLabel(s) {
  if (!s) return '';
  const diff = daysUntil(s);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === -1) return '昨天';
  return s;
}
function weekDayCN(s) {
  const d = parseDate(s);
  if (!d) return '';
  const w = ['日','一','二','三','四','五','六'][d.getDay()];
  return '周' + w;
}

// 本周起始日（周一）
function weekStart() {
  const d = new Date();
  const day = d.getDay() || 7; // 周日=0 -> 7
  d.setDate(d.getDate() - (day - 1));
  return toDateStr(d);
}

// 时长格式化：分钟 -> "Xh Ym" 或 "Xm"
function fmtMinutes(min) {
  min = Math.max(0, Math.round(min || 0));
  if (min < 60) return min + ' 分';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? h + ' 小时 ' + m + ' 分' : h + ' 小时';
}

// 时长 -> 小时带小数（用于统计）
function minutesToHours(min) { return Math.round(min / 60 * 10) / 10; }

// 转义 HTML（防注入）
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}

// 日期输入当前值 yyyy-mm-dd
function inputDateToday() { return todayStr(); }

// 生成缩略图：把图片 blob 压缩到最长边 max 像素内的 JPEG blob
async function makeThumb(blob, max = 240) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1) { bmp.close(); return blob; }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await new Promise(resolve => {
      c.toBlob(b => resolve(b || null), 'image/jpeg', 0.75);
    });
  } catch (e) { return null; }
}

// ---- 错题复习（F-08）：自适应间隔与到期计算 ----
const REVIEW_INTERVALS = [3, 5, 7, 10, 14, 21, 30];
// 复习历史每题最多保留条数（超限丢最旧，防存储膨胀）
const REVIEW_HISTORY_MAX = 30;

// 下一复习间隔(天)：首档取可配置的基础间隔 base（新题/做错后回到），做对后按固定序列递增
function nextReviewInterval(reviewCount, base) {
  if (!reviewCount) return base == null ? REVIEW_INTERVALS[0] : Math.max(0, Math.min(5, base));
  return REVIEW_INTERVALS[Math.min(reviewCount, REVIEW_INTERVALS.length - 1)];
}

// 到期时间戳：lastReviewedAt + 间隔；从未复习按 created + 3 天
function reviewDue(w, intervalBase) {
  const anchor = w.lastReviewedAt || w.created || Date.now();
  return anchor + nextReviewInterval(w.reviewCount, intervalBase) * 86400000;
}

// 复习元信息：due/逾期天数/距上次复习天数/距到期天数
function reviewMeta(w, intervalBase) {
  const now = Date.now();
  const due = reviewDue(w, intervalBase);
  return {
    due,
    overdueDays: Math.max(0, Math.floor((now - due) / 86400000)),
    daysSince: w.lastReviewedAt ? Math.max(0, Math.floor((now - w.lastReviewedAt) / 86400000)) : null,
    daysToDue: Math.max(0, Math.ceil((due - now) / 86400000))
  };
}

// 逾期等级：''=未到期 / due=到期(黄) / warn=逾期3-6天(橙) / danger=逾期≥7天(红)
function overdueLevel(overdueDays) {
  if (overdueDays >= 7) return 'danger';
  if (overdueDays >= 3) return 'warn';
  if (overdueDays >= 1) return 'due';
  return '';
}

// 时长格式化：秒 -> 「3分25秒」/「45秒」（REQ-007 复习计时）
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec <= 0) return '0秒';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m) return s ? `${m}分${s}秒` : `${m}分`;
  return `${s}秒`;
}
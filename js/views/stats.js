/* ===== views/stats.js =====
   学习统计看板（P3/REQ-005）：复习趋势 / 各科掌握度 / 薄弱点分布。
   全部只读，由现有数据派生，不改存储。 */

'use strict';

const StatsView = (() => {
  let el;

  function mount(container) {
    el = container;
    render();
  }

  // 近 14 天复习次数（取各题 reviewHistory 的 at 按日聚合）
  function reviewTrend() {
    const byDay = {};
    Object.values(Controller.getState().wrongQuestions).forEach(w => {
      (w.reviewHistory || []).forEach(h => {
        if (!h) return;
        const d = toDateStr(new Date(h.at));
        byDay[d] = (byDay[d] || 0) + 1;
      });
    });
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const date = todayStr(-i);
      out.push({ date, count: byDay[date] || 0, label: String(new Date(date).getDate()) });
    }
    return out;
  }

  // 复习时长：近 14 天按日聚合 elapsedSec + 累计/今日（REQ-007 计时）
  function secondsTrend() {
    const byDay = {};
    let totalSec = 0, todaySec = 0;
    const t = todayStr();
    Object.values(Controller.getState().wrongQuestions).forEach(w => {
      (w.reviewHistory || []).forEach(h => {
        if (!h || !h.elapsedSec) return;
        totalSec += h.elapsedSec;
        const d = toDateStr(new Date(h.at));
        byDay[d] = (byDay[d] || 0) + h.elapsedSec;
        if (d === t) todaySec += h.elapsedSec;
      });
    });
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const date = todayStr(-i);
      out.push({ date, sec: byDay[date] || 0, label: String(new Date(date).getDate()) });
    }
    return { trend: out, totalSec, todaySec };
  }

  function subjectMastery(wrong) {
    return SUBJECTS.map(su => {
      const list = wrong.filter(w => w.subject === su.key);
      const total = list.length;
      const mastered = list.filter(w => (w.reviewCount || 0) >= 3 && !w.permanent).length;
      const permanent = list.filter(w => w.permanent).length;
      const pct = total ? Math.round(mastered / total * 100) : 0;
      return { key: su.key, name: su.name, total, mastered, permanent, pct };
    });
  }

  function render() {
    const s = Controller.getState();
    const all = Object.values(s.wrongQuestions);
    const total = all.length;
    const trend = reviewTrend();
    const trendMax = Math.max(1, ...trend.map(d => d.count));
    const dur = secondsTrend();
    const durMax = Math.max(1, ...dur.trend.map(d => d.sec));
    const mastery = subjectMastery(all);
    const weak = Controller.weakPointStats();
    const weakTotal = Object.values(weak).reduce((a, b) => a + b, 0);
    const weakMax = Math.max(1, ...Object.values(weak));

    el.innerHTML = `
      <div class="card-head">
        <div class="card-title"><span class="ico">${UI.icon('chart', 15)}</span>数据看板 <span class="chip">共 ${total} 题错题</span></div>
      </div>

      <div class="card">
        <div class="card-title mb-2"><span class="ico">${UI.icon('repeat', 15)}</span>复习趋势 <span class="chip">近 14 天</span></div>
        ${total ? `
        <div class="trend-chart">
          ${trend.map(d => `
            <div class="trend-col" title="${esc(d.date)} · ${d.count} 次复习">
              <div class="trend-bar-wrap"><i class="trend-bar" style="height:${d.count ? Math.max(3, Math.round(d.count / trendMax * 100)) : 2}%"></i></div>
              <span class="trend-label">${d.label}</span>
            </div>`).join('')}
        </div>
        <div class="small muted mt-1">每次复习（做对/做错）计 1 次，红点标今日</div>`
        : `<div class="empty" style="padding:18px"><div class="empty-icon">${UI.icon('chart', 28)}</div><div class="empty-title">还没有复习记录</div><div>收录错题并开始复习后，这里会展示你的复习节奏</div></div>`}
      </div>

      <div class="card mt-3">
        <div class="card-title mb-2"><span class="ico">${UI.icon('timer', 15)}</span>复习时长 <span class="chip">近 14 天</span></div>
        ${dur.totalSec ? `
        <div class="trend-chart">
          ${dur.trend.map(d => `
            <div class="trend-col" title="${esc(d.date)} · ${fmtDur(d.sec)}">
              <div class="trend-bar-wrap"><i class="trend-bar" style="height:${d.sec ? Math.max(3, Math.round(d.sec / durMax * 100)) : 2}%"></i></div>
              <span class="trend-label">${d.label}</span>
            </div>`).join('')}
        </div>
        <div class="small muted mt-1">累计复习 <b class="text-primary">${fmtDur(dur.totalSec)}</b> · 今日已复习 <b class="text-primary">${fmtDur(dur.todaySec)}</b></div>`
        : `<div class="empty" style="padding:18px"><div class="empty-icon">${UI.icon('timer', 28)}</div><div class="empty-title">还没有计时记录</div><div>从「复习」弹窗完成一次复习后，这里会累计你的复习时长</div></div>`}
      </div>

      <div class="grid grid-cols-2 mt-3">
        <div class="card">
          <div class="card-title mb-2"><span class="ico">${UI.icon('book', 15)}</span>各科掌握度</div>
          ${mastery.map(m => `
            <div class="mini-stat">
              <div class="flex-between">
                <span class="small"><span class="subject-dot ${'sd-' + m.key}"></span>${esc(m.name)}</span>
                <span class="bold">${m.mastered}<span class="muted">/${m.total}</span></span>
              </div>
              <div class="progress mt-1"><i style="width:${m.pct}%"></i></div>
              <div class="stat-sub" style="margin-bottom:12px">已掌握 ${m.mastered} · 永久保留 ${m.permanent}</div>
            </div>`).join('')}
        </div>

        <div class="card">
          <div class="card-title mb-2"><span class="ico">${UI.icon('target', 15)}</span>薄弱点分布 <span class="chip">按「我错在哪」归因</span></div>
          ${weakTotal ? ERROR_TYPES.map(t => {
            const cnt = weak[t.key];
            return `
              <div class="mini-bar">
                <span class="small" style="width:84px">${esc(t.label)}</span>
                <div class="bar-track"><i style="width:${cnt ? Math.round(cnt / weakMax * 100) : 0}%;background:${cnt === weakMax && cnt ? '#e46a6e' : 'var(--color-primary)'}"></i></div>
                <span class="bar-num bold">${cnt}</span>
              </div>`;
          }).join('') : `
            <div class="empty" style="padding:18px"><div class="empty-icon">${UI.icon('target', 28)}</div><div class="empty-title">暂无归因数据</div></div>`}
        </div>
      </div>

      <div class="small muted mt-3">数据实时取自本地错题与复习记录，无额外存储。本页为只读看板。</div>`;
  }

  return { mount, render };
})();
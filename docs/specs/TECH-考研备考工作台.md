# 考研备考工作台 · 技术方案文档（v1.0）

> 关联需求：`docs/specs/PRD-考研备考工作台.md`
> 技术栈：纯前端（HTML + CSS + 原生 JS）响应式单页应用

---

## 1. 技术总体

| 项 | 决定 | 理由 |
|:---|:---|:---|
| 形态 | 响应式 Web 单页应用（SPA） | 电脑/手机浏览器通用，零安装 |
| 语言 | 原生 HTML/CSS/JS（ES6+） | 零框架依赖，打开即用，无需构建/后端 |
| 存储 | localStorage + IndexedDB | 数据本地永久保存，可导出备份 |
| 样式 | 自定义 CSS + CSS 变量 → 日系留白简洁风 | 可控、轻量、符合"不过度花哨" |

### 1.1 不支持特性的降级（普通浏览器）

常用现代浏览器均支持 `.tagOpenFile()`（文件选择）与 `<input type="file">`、`IndexedDB`、`localStorage`。无需 Promise/Polyfill。若浏览器为 IE11 及更早版本，功能无法完整使用（需求范围不支持旧浏览器）。

---

## 2. 架构 → 目录约定

```
考研生涯/
├── index.html                单入口
├── assets/                   inline SVG 图标、字体（可选）
├── docs/
│   ├── specs/                PRD、技术方案（本文件）
│   └── plan/                 实施计划
└── src/
    ├── css/
    │   ├── base.css          reset + CSS 变量 + 基本排版/工具类
    │   ├── layout.css        布局（侧栏 + 主区 + 响应式断点）
    │   └── components.css    组件（卡片、进度条、表单、弹窗、错题卡…）
    ├── js/
    │   ├── utils.js          日期/倒计时/时长/进度/统计/尺寸格式化工具
    │   ├── store.js          localStorage + IndexedDB 统一封装（含迁移钩子）
    │   ├── controller.js     状态管理（读取/写入，事件总线的发布订阅）
    │   ├── router.js         视图切换（hash 无刷新）
    │   ├── views/            各页面渲染函数（每页一个模块）
    │   │   ├── dashboard.js      首页 F-01
    │   │   ├── plan.js           学习计划 F-02
    │   │   ├── subject.js        科目进度 F-03
    │   │   ├── pastPaper.js      真题管理 F-04
    │   │   ├── mockExam.js       模考成绩 F-05
    │   │   ├── material.js       资料库 F-06
    │   │   └── wrongBook.js      错题簿 F-07（核心）
    │   └── app.js            入口，router + controller 装配
    └── index.js              浏览器入口挂载（可选合一）
```

> 说明：纯静态交付时可直接用 `src/` 下的文件，`运行时禁止依赖打包器`。

---

## 2'. 模块划分与单向依赖

```
app.js (装配)
  └─ router.js → 决定当前 hash 对应视图
        └─ views/*.js (页面渲染与事件)
              └─ controller.js (业务状态：读写 + 事件发布)
                    └─ store.js (持久层抽象：localStorage/IndexedDB)
```
- 每个模块职责单一，通过 `controller` 交换数据，不直接操作 `store`/`localStorage`。
- 视图层只负责渲染与 DOM 事件，不持有持久化逻辑。

---

## 3. 数据存储设计

### 3.1 结构化数据：localStorage

单 key `kylc:data` 存全部 JSON，含版本号以支持迁移：

```jsonc
{
  "_version": 1,
  "settings":   { "examDate": "2026-12-19", "school": "", "targetScore": null, "totalDailyMin": 0, "dailyReviewGoal": 0, "reviewBaseInterval": 3 },
  "tasks":      [ { "id":"…", "subject":"…", "title":"…", "dueDate":"…", "priority":"high|mid|low", "done":false, "created":12345 } ],
  "subjects":   { "english": {"enabled":true, "percent":0,"stage":""}, "political":{…}, "math":{…}, "pro":{…} },
  "pastPapers": [ { "id":"…", "subject":"…", "title":"…", "date":"…", "usedTimeMin":0, "score":0, "wrongNum":0 } ],
  "mockExams":  [ { "id":"…", "subject":"…", "score":0, "date":"…", "note":"" } ],
  "materials":  [ { "id":"…", "subject":"…", "title":"…", "tags":[], "images":[blobId…], "note":"" } ],
  "wrongQuestions": [ { "id":"…", "subject":"…", "title":"…", "errorType":"concept|calc|reading|formula|time|other",
                        "customError":"", "keyStep":"", "recurCount":0, "permanent":false,
                        "reviewCount":0, "lastReviewedAt":null,
                        "reviewHistory":[ { "at":12345, "correct":true, "elapsedSec":45, "reasonKey":"", "reasonText":"" } ],
                        "images":[blobId…], "created":…, "updated":… } ]
}
```

### 3.2 图片：IndexedDB

- 数据库名 `kylc-images`，store：`images`（key=blobId，value=Blob）
- 视图层先调 `store.saveImage(file) → blobId`，再将其写入结构化 `images` 数组引用
- 提供 `store.getImage(blobId) → Blob/URL`，渲染用 `URL.createObjectURL`，注意释放
- 提供 `exportImages` / `importImages` 备份；图片体积压缩阈值在 `saveImage` 内处理提示

### 3.3 状态持久化与容错

- 每次写操作 → 写 localStorage `kylc:data`
- 读时校验 `_version`，低于当前版本走 `migrate()`（默认空实现/可扩展）
- 存储满（QuotaExceeded）→ 弹提示引导「导出备份 + 清理」

---

## 4. 响应式与布局

| 断点 | 布局 | 说明 |
|:---|:---|:---|
| ≥ 1024px | 左侧固定侧栏 + 右侧主区 | 桌面多栏 |
| 768–1024px | 侧栏收进顶部/抽屉 | 平板折中 |
| < 768px | 单栏，底部浮动 Tab 导航 | 手机触屏友好，图片上传入口显著 |

- 布局用 CSS Grid + Flexbox；表格改用卡片网格避免固定宽拥挤
- 页面根容器用 `min-width:0`/`max-width` 自适应，不用硬编码偏死宽度
- 颜色统一由 `:root` 的语义 CSS 变量控制（主色、强调、危险、文本梯度），保证一致与易改

---

## 5. 错题簿（F-07 核心）技术要点

1. **四栏属性**：表单字段 `title(知识点) / errorType(单选5类) / keyStep(文本) / recurCount(数字+按钮)`
2. **错误类型常量**：`concept|calc|reading|formula|time` + `other(自定义)`
3. **复发逻辑**：编辑错题时点击"再错+1"→ `recurCount++`；当 `recurCount >= 3` 自动标 `permanent=true`（显示"永久保留"徽标）
4. **薄弱点统计**：按 `errorType` 聚合计数（同一题多类另计），首页/错题簿展示柱状或计数卡，标注 top 错误类型
5. **筛选**：按科目 + 按 `未掌握(recurCount=0 且 reviewCount<3)` / `复发中(recurCount≥1 且 reviewCount<3)` / `已掌握(reviewCount≥3)` / `永久保留(permanent=true)` 四档互斥过滤；已掌握优先于复发中
6. **图片**：`<input type=file accept="image/*" capture=environment>` 手机直接拍照；多图支持；显示缩略图
7. **图片压题**（可选增强，默认不做）：留 `canvas` 标注能力接口，暂不实现

---

## 5'. 错题复习与排行榜（F-08）技术要点

> 关联需求：`Requirements/REQ-20260915-002.md`

1. **新增字段**（每条错题）：`reviewCount`（成功复习次数，做错归零）、`lastReviewedAt`（最近复习时间戳 ms，`null` = 从未复习）。`Store.migrate()` 逐条补齐默认值；`CURRENT_VERSION` 1 → 2，旧备份导入自动升级。
2. **间隔常量**：`REVIEW_INTERVALS = [3, 5, 7, 10, 14, 21, 30]`（天），下标 = `reviewCount`。`nextReviewInterval(reviewCount, base)`：`reviewCount=0` → `clamp(base,0,5)`（默认 3，见 REQ-006）；`reviewCount≥1` → `REVIEW_INTERVALS[Math.min(reviewCount,6)]`。
3. **到期计算**：`due = lastReviewedAt ? lastReviewedAt + nextInterval*86400000 : created + nextInterval(0)*86400000`（`intervalBase` 可配置）；`now >= due` 视为到期，进入「待复习」队列。
4. **controller 新方法**：
   - `markReviewed(id, correct)`：做对 → `reviewCount++`、`lastReviewedAt=now`；做错 → `recurCount++`（≥3 标 `permanent`）、`reviewCount=0`、`lastReviewedAt=now`；persist + `emit('change')`。
   - `reviewDueList()`：返回到期题按 due 升序，附带 `overdueDays`。
   - `ranking(limit=10)`：按 `recurCount` 降序，次级按 `updated` 降序。
5. **视图**：错题簿三标签（待复习/全部/排行榜），hash 支持 `#/wrong?tab=review` 直达「待复习」；复习弹窗复用 `UI.openModal`，展示题目图片 + 知识点标题 + 两个结果按钮（做对了/又做错了）。
6. **徽标**：`router.js` 渲染侧栏与手机 Tab 导航时对「错题簿」项追加红点徽标（到期数，为 0 隐藏）；监听 controller `'change'` 事件刷新。
7. **逾期分级**：黄（到期 1–2 天）/ 橙（逾期 3–6 天）/ 红（逾期 ≥ 7 天），用 `:root` 语义色变量。

---

## 5''. 复习深度 + 数据洞察 + 每日目标（REQ-005）技术要点

> 关联需求：`Requirements/REQ-20260915-005.md`

1. **复习历史轨迹（P1）**：
   - 每条错题新增 `reviewHistory: Array<{at:number, correct:boolean}>`，全部字段在 `Store.migrate()` 与 `addWrongQuestion` 默认值中补齐开。
   - `Controller.markReviewed(id, correct)` 在更新 `reviewCount/recurCount/lastReviewedAt` 后追加一条 `{ at: Date.now(), correct }`，并截断至最近 30 条（`REVIEW_HISTORY_MAX = 30`）。
   - 错题卡/复习弹窗展示最近数次轨迹（✓/✗ + 日期）与累计正确率（对次数 / 记录条数）；正确率与轨迹均由 `reviewHistory` 派生，不改其他字段。
2. **每日复习目标（P5）**：`settings.dailyReviewGoal`（0=未设置）。首页「今日复习数」= 今天 `toDateStr(entry.at)` 的 `reviewHistory` 条数总和；首页卡片显示 `x / 目标 y` 进度条，达成高亮；目标设置并入「目标设置」弹窗。
3. **学习统计看板（P3）**：新增 `js/views/stats.js`，路由 `#/stats`，侧栏/手机 Tab 新增「📊 数据」入口。全部只读派生：
   - 复习趋势：近 14 天按日聚合 `reviewHistory` 条数 → 条形图。
   - 各科掌握度：每科总题数、已掌握（`reviewCount≥3` 且非 permanent）、永久保留数 → 进度条。
   - 薄弱点分布：复用 `Controller.weakPointStats()`。
   - 复用现有 `card`/`mini-bar` 样式，无新增依赖，无图片 hydrate。
4. **迁移与备份兼容**：`migrate()` 对错题补齐 `reviewHistory:[]`、settings 合并 `dailyReviewGoal`；导出为整包 dump 自动含新字段；导入走 `Store.migrate` 使旧备份无损补齐新字段（无需版本号提升）。

---

## 5'''. 复习基础间隔可配置（REQ-006）

> 关联需求：`Requirements/REQ-20260915-006.md`

1. **新增字段**：`settings.reviewBaseInterval`（默认 3，合法范围 0–5）。`Store.migrate()` 经 `Object.assign(defaultData().settings, …)` 自动回填，旧数据零迁移成本、无需备份回滚、`CURRENT_VERSION` 不升。
2. **语义**：即错题「首档复习间隔」——新题首次到期、以及做错清零后再到期都回到 `base` 天；之后做对按固定序列 `[5,7,10,14,21,30]` 递增。`nextReviewInterval(reviewCount, base)`：`reviewCount=0` → `clamp(base,0,5)`；`reviewCount≥1` → `REVIEW_INTERVALS[reviewCount]`。
3. **到期透传**：`reviewDue(w, intervalBase)` / `reviewMeta(w, intervalBase)` 增加可选 `intervalBase` 参数，由 `Controller.reviewDueList()` 读 `state.settings.reviewBaseInterval` 传入；视图层 `wrongBook.js` 以 `Controller.getSettings().reviewBaseInterval` 统一展示「首次到期文案 / 下次间隔 / 做错提示」，不再硬编码 3。
4. **设置入口**：首页「目标设置」弹窗新增「错题复习基础间隔（天，0=收录后立即到期）」输入项；保存时 `clamp` 0–5，留空回退默认 3。设 0 后新错题立即进入「待复习」，用于快速验证复习闭环。

---

## 5''''. 复习计时 + 再错错因 + 新归因（REQ-007）

> 关联需求：`Requirements/REQ-20260915-007.md`

1. **归因扩展**：`ERROR_TYPES` 新增 `{ key:'method', label:'方法没想到' }`，作用于「我错在哪」多选、再错错因、薄弱点统计、筛选与搜索（均为 `ERROR_TYPES` 派生的代码常量）。
2. **复习记录字段**：`reviewHistory[]` 单条扩展为 `{ at, correct, elapsedSec?, reasonKey?, reasonText? }`。`Controller.markReviewed(id, correct, opts)` 接收 `{elapsedSec, reasonKey, reasonText}`：做对/做错均写 `elapsedSec`（≥1 秒）；做错写 `reasonKey/reasonText`（可选）。旧条目缺字段即 `undefined`、展示容错，`CURRENT_VERSION` 不升，导出/导入整包自带。
3. **复习计时（wrongBook）**：打开「复习」弹窗即 `rvStart=Date.now()` 并每秒刷新 `⏱ mm:ss`（模块级 `rvTimer/stopTimer`）；「做对了」或「确认错因并结束」时以 `elapsedSec = now - rvStart` 落库；点弹窗 ✕ 仅停表 + 关闭，不计时、不写本次记录。
4. **再错错因交互**：点「✕ 又做错了」展开 `#rv-reason` 面板（预设单选 chips + 选「其他」显示自定义输入），点「确认错因并结束」→ `finishReview(id,false,{reasonKey,reasonText})`；「做对了」→ `finishReview(id,true)`。历史轨迹 `title` 显示耗时与（做错）错因。
5. **数据页时长统计（stats.js）**：新增 `secondsTrend()` 按日聚合各 `reviewHistory.elapsedSec`，新增「复习时长」卡（近 14 天柱状图 + 累计/今日，`fmtDur` 格式化），复用既有 `trend-chart` 样式，无新增依赖。

---

## 6. 关键交互流（数据流）

```
新建错题
  → 选科目 → 填四栏 → 选/拍图片(→ saveImage→IndexedDB)
  → controller.addWrongQuestion(data)
  → store 持久化 → state 更新 → 视图重渲染 → 薄弱点统计刷新
```

```
学习任务
  → 新建任务 → controller 校验 → 持久化 → 首页"今日任务/完成率"联动重渲染
```

---

## 7. 错误处理与边界

- 图片：非图片类型、超大文件 → 校验拦截并提示；IndexedDB 写入失败回滚字段
- 输入：日期非法/优先级非法 → UI 校验提示，不落库
- 空状态：各页「暂无数据」占位引导
- 存储满：捕获 `QuotaExceededError` → 导出提示

---

## 8. 导出与备份

- 一键导出全部结构化数据（JSON 下载）+ 图片（递归 `getImage` → Blob 打包或逐张下载）
- 一键导入恢复（文件选择 `.json` + 图片目录，走 `controller.restore()`）
- 备份文件名带日期戳：`backup-2026-09-15.json`

---

## 9. 测试与验收

- **响应式预览**：分别用桌面宽度(≥1024)与手机宽度(<768)验证布局无溢出、Tab 导航可用
- **数据持久化**：刷新页面数据不丢失；重开浏览器仍在
- **错题全链路**：新建→离线刷新存在→复现+1→临界3次标永久→筛选正确→薄弱点统计更新
- **复习链路（F-08）**：新建错题→3 天后进队列→复习做对→下次间隔 5 天→再复习做错→recurCount+1 且间隔回 3 天→侧栏红点数字正确→排行榜按复发次数排序
- **数据迁移**：旧备份/旧数据导入后 `reviewCount`/`lastReviewedAt` 自动补齐、无异常
- **图片链路**：上传/拍照成功入库→渲染缩略图→导出存在→导入恢复
- **容错**：非法输入被拦截；存储满有提示
- **REQ-005**：复习后 `reviewHistory` 各追加 1 条且 ≤30；错题卡显示轨迹与正确率；首页每日复习 x/目标 y 随设置与复习变化；`#/stats` 数据页三块统计与错题簿一致；导出 →清空→导入后数据画像完整；旧版备份导入后 `reviewHistory`/`dailyReviewGoal` 被补齐
- **REQ-006**：设置可改 `settings.reviewBaseInterval`；设 0 后新收录错题立即进「待复习」；复习做对后间隔进入下一档（5 天）；值被 clamp 0–5；默认 3 保持原备考节奏
- **REQ-007**：复习弹窗实时计时且完成落库、✕ 退出不计时；「又做错了」可选再错错因（含方法没想到）落库；做错「方法没想到」计入薄弱点；数据页「复习时长」显示累计/今日时间

---

## 10. 与其他文档的关系

- 需求：`docs/specs/PRD-考研备考工作台.md`
- 实施计划：`docs/plan/PLAN-考研备考工作台.md`（由本方案推导）
# 文档地图

> 本表是文档职责到仓库实际路径的唯一索引。每项职责只能有一个当前事实来源。本表只用于导航，不记录产品或技术事实，也不覆盖项目既有文档优先级。

## 优先级与实际路径

| 职责 | 实际路径 | 更新触发条件 |
|---|---|---|
| 项目协作契约 | `AGENTS.md` | 规则、提交范围、文档流程变化 |
| 文档地图 | `DOCUMENT_MAP.md` | 创建、替换或移动文档/目录 |
| 需求台账 | `Requirements/LEDGER.md` | 每个非 Bug 需求 |
| 详细需求记录 | `Requirements/REQ-*.md` | 复杂、长期或跨模块需求 |
| 技术方案 | `docs/specs/TECH-考研备考工作台.md` | 实现、架构、接口、数据或兼容变化 |
| 产品需求 | `docs/specs/PRD-考研备考工作台.md` | 产品行为、范围或用户流程变化 |
| 功能进度台账 | `Progress/LEDGER.md` | 大任务创建、阶段状态或归档变化 |
| 功能进度记录 | `Progress/PROG-REQ-*.md` | 大任务的阶段计划、进度、DoD、证据或阻塞变化 |
| 决策台账 | `Decisions/LEDGER.md` | 数据、架构或难以回退的方案（本任务暂无，视需要创建） |
| Bug 台账 | `docs/BUG_TRACKER.md` | 发现、修复或验证 Bug |

## 首次接入记录

- 接入日期：2026-09-15
- 沿用的既有目录/文档：`docs/specs/`（PRD、技术方案）
- 新建的缺失职责：`AGENTS.md`、`DOCUMENT_MAP.md`、`Requirements/LEDGER.md`、`Requirements/REQ-20260915-001.md`、`Progress/LEDGER.md`、`Progress/PROG-REQ-20260915-001.md`
- 不适用职责及理由：本项目为个人纯前端单用户应用，无多用户权限、无后端 Bug 追踪需求；Bug 台账按需启用。
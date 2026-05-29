# ai-test-pipeline 使用说明

`ai-test-pipeline` 是一套面向 AI Agent 的测试流水线技能包，覆盖：

- 项目分析（索引地图）
- 接口用例生成（**API 主流程**驱动，支持 mockData）
- 功能用例生成（**业务主流程**驱动）
- 接口执行与 Markdown 报告
- UI 执行与 Markdown 报告

核心原则：**覆盖率 + 链路完整性优先**，不以用例条数 KPI 作为验收标准。

---

## 1. 目录总览

- `project-analyzer/`：扫描项目入口层，输出 `project-analysis`
- `api-test-case-generate/`：基于 Controller/DTO 识别**业务主流程**并生成 API 用例
- `functional-test-case-generate/`：基于 Router/View 识别**业务主流程**并生成 UI 用例
- `api-test-execute/`：执行 API 用例并生成 Markdown 报告
- `ui-test-execute/`：执行功能用例并生成 Markdown 报告
- `_shared/`：全局 Schema、术语、断言语法、报告模板（索引见 `_shared/目录.md`）
- `scripts/`：执行脚本（`run-api-tests.mjs`、`run-functional-tests.mjs`）

### 1.1 各技能文档结构

每个技能目录采用**语义化文件名**（无 `01_` 编号），结构如下：

| 技能 | 核心文档 |
|------|----------|
| `project-analyzer/` | `SKILL.md` · `工作流.md` · `输出规范.md` · `多栈扫描指南.md` · `下游衔接.md` · `完整示例.md` |
| `api-test-case-generate/` | `SKILL.md` · `主流程识别与设计.md` · `工作流.md` · `智能编排.md` · `验收与输出.md` · `完整示例.md` |
| `functional-test-case-generate/` | `SKILL.md` · `主流程识别与设计.md` · `菜单导航与步骤.md` · `工作流.md` · `智能编排.md` · `验收与输出.md` · `完整示例.md` |
| `api-test-execute/` | `SKILL.md` · `工作流.md` · `结果判定与示例.md` |
| `ui-test-execute/` | `SKILL.md` · `工作流.md` · `浏览器配置.md` · `结果判定与示例.md` |

---

## 2. 推荐使用顺序（标准闭环）

1. 运行 `project-analyzer`
   - 输出：`test-artifacts/project-analysis-{ts}.json`
2. 运行 `api-test-case-generate` 与 `functional-test-case-generate`
   - 输出：
   - `test-artifacts/api-cases/api-cases-{ts}.json`
   - `test-artifacts/functional-cases/functional-cases-{ts}.json`
3. 运行执行器
   - API：`node scripts/run-api-tests.mjs`
   - UI：`node scripts/run-functional-tests.mjs`
4. 查看报告
   - `test-artifacts/api-reports/api-report-{ts}.md`
   - `test-artifacts/ui-reports/ui-report-{ts}.md`

---

## 3. 路径与执行约定

- `scripts/` 与 `test-artifacts/` 为同级目录。
- 所有脚本默认从当前工作目录解析 `./test-artifacts`。
- 支持 `--artifacts-dir <dir>` 覆盖默认产物目录。
- 在包含 `test-artifacts/` 的目录执行命令，**不要 `cd test-artifacts`**。

---

## 4. 关键数据流

- 分析层（地图）：`project-analysis`
  - `modules[].endpoints[]`、`modules[].routes[]`
  - `auth`、`scanLimitations`、`chainHints`
- 生成层（清单 + 用例）：
  - API：`coverage.mainFlowInventory` + `mockData` + `flowChains`
  - UI：`coverage.mainFlowInventory` + `routeMenuMap` + `flowChains`
  - 追溯：API `flowRef`、UI `featureRefs` → `FLOW-*`
  - 链路：`dependsOnCases`、`produces`、`consumes`（UI 可含 `steps.saveAs/useVar`）
- 执行层（确定性执行器）：
  - 依赖校验、变量消费/产出校验、断言判定、Markdown 报告生成

---

## 5. 产物清单

统一产物目录：`test-artifacts/`

- `project-analysis-{ts}.json`
- `api-cases/api-cases-{ts}.json`
- `functional-cases/functional-cases-{ts}.json`
- `api-reports/api-report-{ts}.md`
- `ui-reports/ui-report-{ts}.md`
- `ui-reports/screenshots/`（UI 失败/步骤截图）
- `latest`（最新时间戳指针）

---

## 6. 常用命令

### 6.1 执行

```bash
# API（零依赖，Node 内置 fetch）
node scripts/run-api-tests.mjs
node scripts/run-api-tests.mjs --limit 20
node scripts/run-api-tests.mjs --module orders
node scripts/run-api-tests.mjs --ids TC-API-AUTH-001,TC-API-ORDERS-001
node scripts/run-api-tests.mjs --base-url http://localhost:8080

# UI（Playwright）
node scripts/run-functional-tests.mjs --limit 20
node scripts/run-functional-tests.mjs --local-chrome --limit 20
node scripts/run-functional-tests.mjs --headless --all
```

### 6.2 npm scripts（等价入口）

```bash
npm run test:api
npm run test:ui
```

---

## 7. 适用与边界

- 适用：前后端分离项目、全栈单体、以 REST/页面路由为主的系统
- 不适合直接覆盖：纯性能压测、复杂流媒体协议、无稳定接口契约的临时系统
- UI 执行依赖 Playwright（`package.json` 为 optionalDependencies）

---

## 8. 常见误用（务必避免）

- 用例按固定条数模板生成（如每端点/路由固定 N 条）
- 未读 DTO/View 就写契约/功能点
- 写死账号口令或主键（如 `admin/123admin`、`id=1`）
- 有业务依赖却不写链路字段（`dependsOnCases`、`produces/consumes`）
- 未启动后端/前端服务就执行用例

---

## 9. 快速验收清单

- [ ] `project-analysis` 含 `scanLimitations`，且字段如实
- [ ] API 与功能用例都包含各自 coverage 清单（API：`mainFlowInventory`；UI：`mainFlowInventory`）
- [ ] 主流程覆盖率 100%（API + UI）
- [ ] 执行成功产出 Markdown 报告（API + UI）
- [ ] 报告中含覆盖率统计与失败/跳过明细

---

详细架构与图示见：`架构与流程.md`。

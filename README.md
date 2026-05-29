# ai-test-pipeline 使用说明

`ai-test-pipeline` 是一套面向 AI Agent 的测试流水线技能包，覆盖：

- 项目分析（索引地图）
- 接口用例生成（契约驱动）
- 功能用例生成（功能清单驱动）
- 接口执行与报告
- UI 执行与报告
- 结果回归对比（baseline）

核心原则：**覆盖率 + 链路完整性优先**，不以用例条数 KPI 作为验收标准。

> 当前仓库按本地运行维护：不内置 GitHub Actions 工作流。机检、执行与回归均通过 `scripts/` 命令触发。

---

## 1. 目录总览

- `project-analyzer/`：扫描项目入口层，输出 `project-analysis`
- `api-test-case-generate/`：基于 Controller/DTO 生成 API 用例
- `functional-test-case-generate/`：基于 Router/View 生成功能用例
- `api-test-execute/`：执行 API 用例并生成三份产物（报告 + 机读结果 + JUnit 报告）
- `ui-test-execute/`：执行功能用例并生成三份产物（报告 + 机读结果 + JUnit 报告）
- `_shared/`：全局 Schema、术语、断言语法、报告模板、选择器策略
- `scripts/`：机检 + 执行 + 回归脚本

---

## 2. 推荐使用顺序（标准闭环）

1. 运行 `project-analyzer`
   - 输出：`test-artifacts/project-analysis-{ts}.json`
2. 运行 `api-test-case-generate` 与 `functional-test-case-generate`
   - 输出：
   - `test-artifacts/api-cases/api-cases-{ts}.json`
   - `test-artifacts/functional-cases/functional-cases-{ts}.json`
3. 执行前机检（建议默认严格）
   - `node scripts/validate-api-cases.mjs --strict --enforce-chain`
   - `node scripts/validate-functional-cases.mjs --strict --enforce-chain`
4. 运行执行器
   - API：`node scripts/run-api-tests.mjs`
   - UI：`node scripts/run-functional-tests.mjs`
5. 回归守护（可选但推荐）
   - 首次建基线：`node scripts/compare-results.mjs --update-baseline`
   - 后续回归对比：`node scripts/compare-results.mjs --fail-on-regression`

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
  - API：`coverage.endpointContracts` + `flowChains`
  - 功能：`coverage.featureInventory` + `flowChains`
  - 追溯字段：`contractRef/scenarioRef`、`featureRef/featureRefs`
  - 链路字段：`dependsOnCases`、`produces`、`consumes`（UI 可含 `steps.saveAs/useVar`）
- 执行层（确定性执行器）：
  - 依赖校验、变量消费/产出校验、断言判定、报告生成
  - 机读结果输出（供 `compare-results.mjs`）

---

## 5. 产物清单

统一产物目录：`test-artifacts/`

- `project-analysis-{ts}.json`
- `api-cases/api-cases-{ts}.json`
- `functional-cases/functional-cases-{ts}.json`
- `api-reports/api-report-{ts}.md`
- `api-reports/api-results-{ts}.json`（机读结果）
- `api-reports/api-junit-{ts}.xml`（JUnit 报告）
- `ui-reports/ui-report-{ts}.md`
- `ui-reports/ui-results-{ts}.json`（机读结果）
- `ui-reports/ui-junit-{ts}.xml`（JUnit 报告）
- `ui-reports/screenshots/`
- `baseline/api-results.json`
- `baseline/ui-results.json`
- `latest`（最新时间戳指针）

---

## 6. 常用命令

### 6.1 机检

```bash
# API
node scripts/validate-api-cases.mjs --strict --enforce-chain

# 功能/UI
node scripts/validate-functional-cases.mjs --strict --enforce-chain
```

### 6.2 执行

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

### 6.3 回归对比

```bash
# 建立基线
node scripts/compare-results.mjs --update-baseline

# 回归门禁
node scripts/compare-results.mjs --fail-on-regression
```

### 6.4 npm scripts（等价入口）

```bash
npm run validate
npm run test:api
npm run test:ui
npm run baseline
npm run compare
npm run compare:ci
```

---

## 7. 执行模式说明

- `normal`：仅 error 失败
- `--strict`：warning 也失败
- `--enforce-chain`：识别到可串联场景时，若无链路用例则失败

建议发布前固定使用：`--strict --enforce-chain`

---

## 8. 适用与边界

- 适用：前后端分离项目、全栈单体、以 REST/页面路由为主的系统
- 不适合直接覆盖：纯性能压测、复杂流媒体协议、无稳定接口契约的临时系统

---

## 9. 常见误用（务必避免）

- 用例按固定条数模板生成（如每端点/路由固定 N 条）
- 未读 DTO/View 就写契约/功能点
- 写死账号口令或主键（如 `admin/123admin`、`id=1`）
- 有业务依赖却不写链路字段（`dependsOnCases`、`produces/consumes`）
- 跳过机检直接执行

---

## 10. 快速验收清单

- [ ] `project-analysis` 含 `scanLimitations`，且字段如实
- [ ] API 与功能用例都包含各自 coverage 清单
- [ ] P0 覆盖率为 100%（契约/功能点）
- [ ] 机检通过（建议 strict + enforce-chain）
- [ ] 执行产物齐全（报告 + 机读结果 + JUnit 报告）
- [ ] 回归基线可建立并可对比

---

详细架构与图示见：`架构与流程.md`。

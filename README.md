# ai-test-pipeline 使用说明

`ai-test-pipeline` 是一套面向 AI Agent 的测试流水线技能包，覆盖：

- 项目分析（索引地图）
- 接口用例生成（契约驱动）
- 功能用例生成（功能清单驱动）
- 接口执行与报告
- UI 执行与报告

核心原则：**覆盖率 + 链路完整性优先**，不以用例条数 KPI 作为验收标准。

---

## 1. 目录总览

- `project-analyzer/`：扫描项目入口层，输出 `project-analysis`
- `api-test-case-generate/`：基于 Controller/DTO 生成 API 用例
- `functional-test-case-generate/`：基于 Router/View 生成功能用例
- `api-test-execute/`：执行 API 用例并生成接口报告
- `ui-test-execute/`：执行功能用例并生成 UI 报告
- `_shared/`：全局 Schema、术语、断言语法、报告模板
- `scripts/`：产物机检脚本

---

## 2. 推荐使用顺序（标准闭环）

1. 运行 `project-analyzer`  
   输出：`test-artifacts/project-analysis-{ts}.json`

2. 运行 `api-test-case-generate` 与 `functional-test-case-generate`  
   输出：
   - `test-artifacts/api-cases/api-cases-{ts}.json`
   - `test-artifacts/functional-cases/functional-cases-{ts}.json`

3. 执行前机检（强烈建议）
   - `node scripts/validate-api-cases.mjs --strict --enforce-chain`
   - `node scripts/validate-functional-cases.mjs --strict --enforce-chain`

4. 运行执行技能
   - `api-test-execute` → `test-artifacts/api-reports/api-report-{ts}.md`
   - `ui-test-execute` → `test-artifacts/ui-reports/ui-report-{ts}.md`

### 2.1 最小可用流程（第一次使用建议）

如果你是第一次接入，建议先跑一个最小闭环：

1. 分析：只跑 `project-analyzer`
2. 生成：先跑 `api-test-case-generate`（比 UI 更快验证）
3. 机检：跑 `validate-api-cases.mjs --strict`
4. 执行：跑 `api-test-execute`，确认报告可产出

确认 API 闭环稳定后，再接入 `functional-test-case-generate` 与 `ui-test-execute`。

### 2.2 在对话中触发各技能（推荐话术）

你可以直接对 Agent 说以下句式：

- `先分析这个项目，输出 project-analysis`
- `基于最新 analysis 生成接口测试用例`
- `基于最新 analysis 生成功能测试用例`
- `执行接口测试用例，并输出报告`
- `执行前 20 条 UI 用例，用本地 Chrome 有头`
- `先机检再执行，开启 strict 和 enforce-chain`

---

## 3. 关键数据流

- 分析层：`project-analysis`
  - `modules[].endpoints[]`、`modules[].routes[]`
  - `auth`
  - `scanLimitations`
  - `chainHints`（链路线索）

- 生成层：
  - API：`coverage.endpointContracts` + `flowChains`
  - 功能：`coverage.featureInventory` + `flowChains`
  - 用例追溯：`contractRef/scenarioRef`、`featureRef/featureRefs`
  - 链路字段：`dependsOnCases`、`produces`、`consumes`（UI 可含 `steps.saveAs/useVar`）

- 执行层：
  - 依赖校验（`dependsOnCases`）
  - 变量消费/产出校验（`consumes`/`produces`）
  - 报告输出覆盖率 + 链路统计

---

## 4. 产物与指针

统一产物目录：`test-artifacts/`

- `project-analysis-{ts}.json`
- `api-cases/api-cases-{ts}.json`
- `functional-cases/functional-cases-{ts}.json`
- `api-reports/api-report-{ts}.md`
- `ui-reports/ui-report-{ts}.md`
- `latest`（最新时间戳指针）

机检脚本位于包根目录 `scripts/`：

- `validate-api-cases.mjs`
- `validate-functional-cases.mjs`

---

## 5. 执行模式说明

- `normal`：仅 error 失败
- `--strict`：warning 也失败
- `--enforce-chain`：识别到可串联场景时，若无链路用例则失败

发布前建议固定使用：

- `--strict --enforce-chain`

---

## 6. 常用命令速查

> 以下命令在技能包根目录执行。

### 6.1 机检命令

```bash
# API 用例机检（默认读取 latest）
node scripts/validate-api-cases.mjs

# API 严格 + 链路门禁
node scripts/validate-api-cases.mjs --strict --enforce-chain

# 功能用例机检（默认读取 latest）
node scripts/validate-functional-cases.mjs

# 功能 严格 + 链路门禁
node scripts/validate-functional-cases.mjs --strict --enforce-chain
```

### 6.2 UI 执行命令（在 test-artifacts 下）

```bash
cd test-artifacts

# 默认（Playwright Chromium + 有头）执行前 20 条
node scripts/run-functional-tests.mjs --limit 20

# 本地 Chrome + 有头
node scripts/run-functional-tests.mjs --local-chrome --limit 20

# 无头全量
node scripts/run-functional-tests.mjs --headless --all
```

---

## 7. 适用与边界

- 适用：前后端分离项目、全栈单体、以 REST/页面路由为主的系统
- 不适合直接覆盖：纯性能压测、复杂流媒体协议、无稳定接口契约的临时系统

---

## 8. 常见误用（务必避免）

- 用例按固定条数模板生成（如每端点/路由固定 N 条）
- 未读 DTO/View 就写契约/功能点
- 写死账号口令或主键（如 `admin/123admin`、`id=1`）
- 有业务依赖却不写链路字段（`dependsOnCases`、`produces/consumes`）
- 跳过机检直接执行

---

## 9. 常见问题排查

- **机检提示 `latest` 找不到目标文件**
  - 检查 `test-artifacts/latest` 内容是否为时间戳
  - 或直接传入显式文件路径执行机检

- **大量用例因变量缺失被跳过**
  - 检查上游用例是否失败
  - 检查 `dependsOnCases`、`produces/consumes` 是否闭环
  - 检查 `extract` 路径是否与真实响应一致

- **UI 执行找不到元素**
  - 优先确认 `steps.target` 是否来自页面真实文案
  - 检查是否页面未登录或未进入正确路由
  - 必要时先缩小范围（`--limit N`）定位问题

- **API 断言频繁不一致**
  - 优先核对 `GlobalExceptionHandler` 约定（status/body.code）
  - 核对 DTO 字段名与校验注解是否被正确读到

---

## 10. 快速验收清单

- [ ] `project-analysis` 含 `scanLimitations`，且字段如实
- [ ] API 与功能用例都包含各自 coverage 清单
- [ ] P0 覆盖率为 100%（契约/功能点）
- [ ] 机检通过（建议 strict + enforce-chain）
- [ ] 执行报告包含失败明细与链路统计

---

详细架构与图示见：`架构与流程.md`。

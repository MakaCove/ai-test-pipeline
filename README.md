# ai-test-pipeline 使用说明

`ai-test-pipeline` 是面向 AI Agent 的测试流水线技能包，覆盖项目分析、用例生成、校验、执行与报告。

## 目录总览

| 目录 | 说明 |
|------|------|
| `project-analyzer/` | 项目索引分析，输出 `project-analysis` |
| `api-test-case-generate/` | 生成 API 用例 |
| `ui-test-case-generate/` | 生成 UI 用例 |
| `api-test-execute/` | API 执行规范 |
| `ui-test-execute/` | UI 执行规范 |
| `shared/` | 统一术语、结构定义、断言与报告模板 |
| `scripts/` | 执行器与校验器脚本 |

各技能目录内文档按工作流编号命名（如 `01_工作流.md`），索引见各目录 `SKILL.md`。

## 使用步骤

### 前置条件

- Node.js >= 18
- 被测项目的前后端服务已启动（API 默认 `http://localhost:8080`，UI 默认 `http://localhost:5173`）
- UI 执行需安装 Playwright：`npm install playwright`（可选依赖）
- 在**被测项目根目录**（或包含 `test-artifacts/` 的目录）执行下文命令

### 第 1 步：项目分析

在 Cursor 中调用技能 `project-analyzer`，扫描 Controller / Router / 前端路由，生成：

```text
test-artifacts/project-analysis-{ts}.json
```

详细步骤见 `project-analyzer/01_工作流.md`。

### 第 2 步：生成用例

基于上一步产物，分别调用：

| 技能 | 输出 |
|------|------|
| `api-test-case-generate` | `test-artifacts/api-cases/api-cases-{ts}.json` |
| `ui-test-case-generate` | `test-artifacts/ui-cases/ui-cases-{ts}.json` |

生成后写入 `test-artifacts/latest`（时间戳指针），供脚本自动读取最新产物。

**Agent 行为**：生成完成后先询问用户「是否执行校验」，用户回复后再决定是否运行 `validate`（见各生成技能 `01_工作流.md`）。

### 第 3 步：校验产物（可选，由用户决定）

```bash
npm run validate
# 或分别校验
node scripts/validate-artifacts.mjs --type api
node scripts/validate-artifacts.mjs --type ui
```

校验通过后再执行；失败会指出具体字段路径。

### 第 4 步：执行用例

```bash
# API（零额外依赖）
npm run test:api
node scripts/run-api-tests.mjs --limit 20
node scripts/run-api-tests.mjs --base-url http://localhost:8080

# UI（Playwright）
npm run test:ui
node scripts/run-ui-tests.mjs --limit 20
node scripts/run-ui-tests.mjs --local-chrome --limit 20
```

UI 浏览器配置见 `ui-test-execute/02_浏览器配置.md` 与 `shared/09_ui-test-profile模板.md`。

### 第 5 步：查看报告

| 类型 | 路径 |
|------|------|
| API 报告 | `test-artifacts/api-reports/api-report-{ts}.md` |
| UI 报告 | `test-artifacts/ui-reports/ui-report-{ts}.md` |
| UI 截图 | `test-artifacts/ui-reports/screenshots/` |

报告结构分别见 `shared/10_接口报告模板.md`、`shared/11_UI报告模板.md`。

### 快速命令一览

```bash
npm run validate && npm run test:api && npm run test:ui
```

## 标准执行顺序

1. 运行 `project-analyzer`，输出 `project-analysis-*.json`
2. 运行 `api-test-case-generate` 与 `ui-test-case-generate`
3. 校验产物：`npm run validate`
4. 执行用例：`npm run test:api`、`npm run test:ui`
5. 查看报告：`test-artifacts/api-reports/`、`test-artifacts/ui-reports/`

## 核心约束

- Schema：`project-analysis/v2`、`api-case/v2`、`ui-case/v2`
- 命名约定：UI 侧统一使用 `ui-*`（目录、产物、schema、脚本）。
- 链路字段统一使用 `trace.*`：`flowRefs`、`dependsOn`、`produces`、`consumes`
- 执行前建议先通过 `validate`（生成阶段会询问是否立即校验，由用户决定）

## 常用命令

```bash
npm run validate
npm run test:api
npm run test:ui

node scripts/run-api-tests.mjs --limit 20
node scripts/run-ui-tests.mjs --limit 20
node scripts/validate-artifacts.mjs --type all
```

## 产物目录

```text
test-artifacts/
├── latest
├── project-analysis-*.json
├── api-cases/
├── ui-cases/
├── api-reports/
└── ui-reports/
```

脚本默认从当前目录解析 `./test-artifacts`，可通过 `--artifacts-dir` 覆盖。

详细架构见 [架构与流程.md](架构与流程.md)。

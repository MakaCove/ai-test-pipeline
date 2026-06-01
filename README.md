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
- 执行前必须先通过 `validate`

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

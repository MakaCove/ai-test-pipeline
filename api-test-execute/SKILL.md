---
name: api-test-execute
description: 读取接口测试用例生成器输出的 JSON 用例文件，逐条发送 HTTP 请求并验证响应断言，最终生成 Markdown 格式的接口测试报告。当用户要求执行接口测试、运行 API 测试或验证后端接口时使用此技能。
disable-model-invocation: true
---

# 接口测试执行器

读取 `api-test-case-generate` 生成的 JSON 用例文件，由确定性脚本 `scripts/run-api-tests.mjs`
（零依赖，Node 内置 fetch）逐条发送 HTTP 请求并验证响应，生成报告。

## 核心升级

- 确定性执行：`scripts/run-api-tests.mjs` 负责依赖排序、`{{var}}` 替换、断言判定、变量链
- 执行前先做机检门禁：`scripts/validate-api-cases.mjs`
- 支持链路感知执行：识别 `dependsOnCases`、`produces`、`consumes`
- 三份产物：`api-report-{ts}.md` + `api-results-{ts}.json` + `api-junit-{ts}.xml`
- 回归对比：`scripts/compare-results.mjs`

## 快速开始

> 在包含 `test-artifacts/` 的目录执行（与 `scripts/` 同级），不要 `cd test-artifacts`。

1. 定位最新的接口用例文件（脚本自动读 `latest`）。
2. 执行前机检：`node scripts/validate-api-cases.mjs --strict`
3. 确认后端服务运行中。
4. 执行：`node scripts/run-api-tests.mjs`（可加 `--limit/--module/--ids/--base-url`）。
5. 报告写入 `test-artifacts/api-reports/`。
6. 可选回归：`node scripts/compare-results.mjs --kind api`。

## 详细指南

- [01_范围定义.md](01_范围定义.md) — 执行范围与前置条件
- [02_执行工作流.md](02_执行工作流.md) — 完整执行工作流
- [03_结果判定规则.md](03_结果判定规则.md) — 结果判定与报告规则
- [04_完整示例.md](04_完整示例.md) — 完整示例

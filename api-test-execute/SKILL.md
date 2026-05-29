---
name: api-test-execute
description: 读取接口测试用例 JSON，由 run-api-tests.mjs 发送 HTTP 请求并验证断言，生成 Markdown 报告。当用户要求执行接口测试时使用。
disable-model-invocation: true
---

# 接口测试执行器

确定性脚本 `scripts/run-api-tests.mjs`：依赖排序、mockData/`{{var}}` 替换、断言、Markdown 报告。

## 文档

- [工作流.md](工作流.md) — 前置条件、CLI、执行步骤
- [结果判定与示例.md](结果判定与示例.md) — 状态、链路规则、报告摘要
- `_shared/断言语法.md` — 断言算子

## 快速开始

```bash
node scripts/run-api-tests.mjs
node scripts/run-api-tests.mjs --base-url http://localhost:8080 --limit 20
```

报告：`test-artifacts/api-reports/api-report-{ts}.md`

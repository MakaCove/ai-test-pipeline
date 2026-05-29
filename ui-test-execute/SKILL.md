---
name: ui-test-execute
description: 执行 functional-cases JSON，默认自动解析浏览器并有头；生成 UI Markdown 报告与截图。功能/UI 测试执行时触发。
disable-model-invocation: true
---

# UI 测试执行器

确定性脚本 `scripts/run-functional-tests.mjs`：菜单步骤、分层选择器、断言、截图、Markdown 报告。

## 文档

- [工作流.md](工作流.md) — 前置条件、CLI、双通道说明
- [浏览器配置.md](浏览器配置.md) — 自动解析、固定路径、有头/无头
- [结果判定与示例.md](结果判定与示例.md) — 状态、截图、报告摘要
- `_shared/选择器策略.md` — 元素定位

## 快速开始

```bash
node scripts/run-functional-tests.mjs --limit 20
node scripts/run-functional-tests.mjs --local-chrome --limit 20
node scripts/run-functional-tests.mjs --headless --all
```

默认 `auto-headed`：优先固定 ms-playwright 缓存，否则系统 Chrome；仅 `--headless` 时无头。详见 [浏览器配置.md](浏览器配置.md)。

报告：`test-artifacts/ui-reports/ui-report-{ts}.md`

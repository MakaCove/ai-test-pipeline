---
name: ui-test-execute
description: 执行 UI 用例并生成 Markdown 报告与截图。
disable-model-invocation: true
---

# ui-test-execute

确定性脚本 `scripts/run-ui-tests.mjs`：菜单步骤、分层选择器、断言、截图、Markdown 报告。

## 文档索引

| 文档 | 说明 |
|------|------|
| [01_工作流.md](01_工作流.md) | 执行步骤 |
| [02_浏览器配置.md](02_浏览器配置.md) | Playwright 与 profile 配置 |
| [03_结果判定与示例.md](03_结果判定与示例.md) | 判定规则与示例 |

## 执行

```bash
node scripts/validate-artifacts.mjs --type ui
node scripts/run-ui-tests.mjs
```

参考：[shared/07_选择器策略.md](../shared/07_选择器策略.md)

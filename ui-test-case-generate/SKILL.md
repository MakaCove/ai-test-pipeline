---
name: ui-test-case-generate
description: 基于 project-analysis 生成 UI 用例。
disable-model-invocation: true
---

# ui-test-case-generate

## 目标

确认主流程候选并生成可执行的 UI 用例 JSON。

## 文档索引

| 文档 | 说明 |
|------|------|
| [01_工作流.md](01_工作流.md) | 执行步骤 |
| [02_主流程识别与设计.md](02_主流程识别与设计.md) | 主流程识别规则 |
| [03_菜单导航与步骤.md](03_菜单导航与步骤.md) | 菜单驱动步骤设计 |
| [04_智能编排.md](04_智能编排.md) | 依赖与变量编排 |
| [05_验收与输出.md](05_验收与输出.md) | 验收标准 |
| [06_完整示例.md](06_完整示例.md) | 完整产物示例 |

## 输出

- `test-artifacts/ui-cases/ui-cases-{ts}.json`
- schema：`ai-test-pipeline/ui-case/v2`
- Canonical Schema：[shared/05_UI用例结构.md](../shared/05_UI用例结构.md)
- 说明：UI 侧命名统一为 `ui-*`（目录、产物、schema、脚本）。

## 执行

```bash
node scripts/run-ui-tests.mjs
```

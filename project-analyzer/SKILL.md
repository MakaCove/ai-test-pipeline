---
name: project-analyzer
description: 分析项目代码，输出 project-analysis JSON（端点、路由、模块、auth、chainHints），作为测试流水线第一步。当用户要求理解项目结构、梳理接口与路由时使用。
disable-model-invocation: true
---

# 项目分析器

产出 **project-analysis JSON**（地图级索引，非最终契约）。

## 文档

| 文档 | 说明 |
|------|------|
| [工作流.md](工作流.md) | 分析范围与执行步骤 |
| [输出规范.md](输出规范.md) | JSON Schema 与字段 |
| [多栈扫描指南.md](多栈扫描指南.md) | Spring / Vue / React 等 Glob |
| [下游衔接.md](下游衔接.md) | 与用例生成的衔接 |
| [完整示例.md](完整示例.md) | 示例 JSON |
| `_shared/项目分析结构.md` | Canonical Schema |

## 快速开始

1. 按 [工作流.md](工作流.md) 扫描前后端入口
2. 填写 `chainHints`、`scanLimitations`
3. 写入 `test-artifacts/project-analysis-{ts}.json`，更新 `latest`

## 后续

```
project-analysis → api-test-case-generate / functional-test-case-generate → execute → 报告
```

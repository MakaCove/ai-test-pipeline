---
name: project-analyzer
description: 深入分析项目代码（前后端），梳理 API 端点清单、前端路由清单、功能模块划分，输出结构化项目分析 JSON。适用于任意技术栈，作为 ai-test-pipeline 第一步，为接口/功能用例生成提供「地图」而非最终契约。当用户要求理解项目、分析项目结构、梳理接口列表时使用此技能。
disable-model-invocation: true
---

# 项目分析器（Project Analyzer）

扫描前后端代码，输出标准化的 **project-analysis JSON**，供后续用例生成技能引用。

## 核心定位

| 角色 | 说明 |
|------|------|
| **地图，非真相** | 本技能产出端点/路由/模块索引；**DTO 字段、校验规则、页面控件**须由下游 generate 技能读源码补全 |
| **通用多栈** | 不写死 Spring/Vue/JWT；按实际框架识别并如实填写 |
| **无条数 KPI** | 端点/路由数量是扫描结果，不是交付目标 |

## 快速开始

1. 定位前后端目录与技术栈（见 `05_多栈扫描指南.md`）
2. 扫描 API 入口与前端路由（见 `02_执行工作流.md`）
3. 按模块分组，汇总认证策略
4. 写入 `test-artifacts/project-analysis-{时间戳}.json`，更新 `test-artifacts/latest`
5. 输出 `chainHints`（可串联场景线索），帮助下游编排链路
6. 在摘要中说明 **scanLimitations** 与下游待办（见 `06_下游衔接.md`）

## 详细指南

- [01_范围定义.md](01_范围定义.md) — 分析什么、不分析什么
- [02_执行工作流.md](02_执行工作流.md) — 完整执行步骤
- [03_输出规范.md](03_输出规范.md) — JSON Schema 与字段说明
- [04_完整示例.md](04_完整示例.md) — 虚构示例（示意结构，非特定产品）
- [05_多栈扫描指南.md](05_多栈扫描指南.md) — Spring / FastAPI / Nest / Go / Vue / React 等
- [06_下游衔接.md](06_下游衔接.md) — 与 endpointContracts / featureInventory 的衔接

## 后续流水线

```
project-analysis.json
  → api-test-case-generate（读 Controller/DTO 建 endpointContracts）
  → functional-test-case-generate（读 View/Page 建 featureInventory）
```

---
name: functional-test-case-generate
description: 基于 project-analysis 与前端真实页面，识别业务主流程并生成可执行 UI 测试用例；步骤按菜单路径编排。适用任意 Web 项目。
disable-model-invocation: true
---

# UI 测试用例生成器

**主流程模式**：读真实页面与菜单 → 识别全部业务主流程 → 仅生成 `TC-FUNC-{MODULE}-{序号}` 用例（数量不设上限）。

## 文档索引

| 文档 | 说明 |
|------|------|
| [主流程识别与设计.md](主流程识别与设计.md) | **必读** — 识别主流程、编写规则、菜单遍历法 |
| [菜单导航与步骤.md](菜单导航与步骤.md) | **必读** — click_menu、action、navigate 边界 |
| [工作流.md](工作流.md) | 执行步骤与落盘 |
| [智能编排.md](智能编排.md) | **必做** — 依赖排序、执行顺序 |
| [验收与输出.md](验收与输出.md) | 覆盖率验收、coverage 字段 |
| [完整示例.md](完整示例.md) | JSON 示例 |
| `_shared/功能用例结构.md` | Canonical Schema |

## 快速开始

1. 前置 `project-analyzer`
2. 建立 `routeMenuMap` → 确认 `mainFlowCandidates` → `mainFlowInventory`
3. 编写用例（`trace.flowRefs` 追溯）
4. [智能编排.md](智能编排.md) → 落盘 `test-artifacts/functional-cases/`
5. 执行：`node scripts/run-functional-tests.mjs`

## 做什么 / 不做什么

| ✅ | ❌ |
|----|-----|
| 覆盖全部识别出的 UI 主流程 | 每路由固定 N 条模板 |
| 只输出主流程用例 | 分页/筛选/校验失败专项 |
| click_menu 真实菜单路径 | navigate 直链业务页 |
| `trace` 分组统一链路字段 | 每条用例重复登录 |
| 菜单遍历法防遗漏 | 仅凭灵感归纳主流程 |

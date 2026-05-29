---
name: api-test-case-generate
description: 基于 project-analysis 与 Controller/DTO，识别接口业务主流程并生成可执行用例；支持 mockData 辅助测试数据。适用任意 REST 项目。
disable-model-invocation: true
---

# 接口测试用例生成器

**主流程模式**：读真实 Controller/DTO → 识别全部业务主流程 → 仅生成 `TC-API-{MODULE}-{序号}` 用例 → 支持 mockData。

## 文档索引

| 文档 | 说明 |
|------|------|
| [主流程识别与设计.md](主流程识别与设计.md) | **必读** — 识别主流程、mock、编写规则、四维度交叉检查 |
| [工作流.md](工作流.md) | 执行步骤与落盘 |
| [智能编排.md](智能编排.md) | **必做** — 依赖排序、执行顺序 |
| [验收与输出.md](验收与输出.md) | 覆盖率验收、coverage 字段 |
| [完整示例.md](完整示例.md) | JSON 示例 |
| `_shared/接口用例结构.md` | Canonical Schema |

## 快速开始

1. 前置 `project-analyzer` → `project-analysis.json`
2. 按 [主流程识别与设计.md](主流程识别与设计.md) 确认 `mainFlowCandidates` + 交叉检查 → `mainFlowInventory`
3. 编写用例（`trace.flowRefs` 追溯）
4. [智能编排.md](智能编排.md) → 落盘 `test-artifacts/api-cases/`
5. 执行：`node scripts/run-api-tests.mjs`

## 做什么 / 不做什么

| ✅ | ❌ |
|----|-----|
| 识别全部真实 API 主流程 | 每端点 H/V/A/E 模板 |
| 只输出主流程用例 | 校验失败/分页筛选/401 变体专项 |
| mockData 补外键/缺省字段 | 未读 DTO 臆造字段 |
| `trace` 分组统一链路字段 | 硬编码 id/token |
| 四维度交叉检查防遗漏 | 仅凭灵感归纳主流程 |

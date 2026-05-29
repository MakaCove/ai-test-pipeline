---
name: ui-test-execute
description: >
  执行 functional-cases JSON。默认 Playwright 自带 Chromium 有头；用户指定本地 Chrome 或
  无头时按 05_浏览器与Profile选择.md 映射 profile。功能测试/UI 测试/前 N 条/看操作步骤时触发。
disable-model-invocation: true
---

# UI 测试执行器

## 核心升级

- 执行前先做机检门禁：`scripts/validate-functional-cases.mjs`
- 确定性执行：`scripts/run-functional-tests.mjs` 负责依赖排序、变量链、断言与截图
- 支持链路感知执行：识别 `dependsOnCases`、`produces`、`consumes`、`steps.saveAs/useVar`
- 报告输出链路统计：`flowChains` 覆盖与链路失败明细
- 三份产物：`ui-report-{ts}.md` + `ui-results-{ts}.json` + `ui-junit-{ts}.xml`
- 回归对比：`scripts/compare-results.mjs --kind ui`

## 默认行为（用户未说明时）

- **浏览器**：Playwright 自带 Chromium（`ms-playwright/chromium-*`）
- **显示**：**有头**（可见窗口）
- **窗口**：默认最大化（`--start-maximized` + `viewport: null`）
- **profile**：`playwright-headed`

## 用户明确指定时

| 用户说 | 结果 |
|--------|------|
| 本地 Chrome / 系统 Chrome | `local-chrome-headed` 或 `--local-chrome` |
| 无头 / headless / CI | `--headless` 或 `playwright-headless` |

## 必读

1. **`05_浏览器与Profile选择.md`**
2. `02_执行工作流.md`
3. `_shared/ui-test-profile模板.md`

```bash
# 在包含 test-artifacts/ 的目录执行（scripts/ 与 test-artifacts/ 同级），不要 cd test-artifacts
node scripts/validate-functional-cases.mjs --strict
node scripts/run-functional-tests.mjs --limit 20
node scripts/run-functional-tests.mjs --local-chrome --limit 20
node scripts/run-functional-tests.mjs --headless --all
```

## 详细指南

- [01_范围定义.md](01_范围定义.md)
- [02_执行工作流.md](02_执行工作流.md)
- [03_结果判定规则.md](03_结果判定规则.md)
- [04_完整示例.md](04_完整示例.md)
- [05_浏览器与Profile选择.md](05_浏览器与Profile选择.md)

---
name: ui-test-execute
description: >
  执行 functional-cases JSON。默认 Playwright 自带 Chromium 有头；用户指定本地 Chrome 或
  无头时按 05_浏览器与Profile选择.md 映射 profile。功能测试/UI 测试/前 N 条/看操作步骤时触发。
disable-model-invocation: true
---

# UI 测试执行器

## 默认行为（用户未说明时）

- **浏览器**：Playwright 自带 Chromium（`ms-playwright/chromium-*`）
- **显示**：**有头**（可见窗口）
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
cd test-artifacts
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

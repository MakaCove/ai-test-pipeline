# UI 测试 Profile 配置模板

各项目复制到 `test-artifacts/ui-test.config.json`。

## 规则（Agent 必须遵守）

| 维度 | 默认 | 用户明确指定时 |
|------|------|----------------|
| **浏览器** | Playwright 自带 Chromium | 本地 / 系统 Chrome → `local-chrome-*` profile |
| **有头/无头** | **有头**（可见窗口） | 用户说无头/headless/CI → `*-headless` 或 `--headless` |

未指定浏览器且未指定无头 → **`playwright-headed`**（自带 Chromium + 有头）。

## 配置示例

```json
{
  "defaultProfile": "playwright-headed",
  "profiles": {
    "playwright-headed": {
      "description": "默认：Playwright 自带 Chromium，有头",
      "engine": "playwright-chromium",
      "headed": true,
      "slowMo": 1000
    },
    "playwright-headless": {
      "description": "用户指定无头：Playwright 自带 Chromium",
      "engine": "playwright-chromium",
      "headed": false,
      "slowMo": 0
    },
    "local-chrome-headed": {
      "description": "用户指定本地 Chrome，有头",
      "engine": "local-chrome",
      "headed": true,
      "slowMo": 800
    },
    "local-chrome-headless": {
      "description": "用户指定本地 Chrome + 无头",
      "engine": "local-chrome",
      "headed": false,
      "slowMo": 0
    }
  }
}
```

## engine 字段

| engine | 实际启动 |
|--------|----------|
| `playwright-chromium` | `chromium.launch()`（`ms-playwright/chromium-*`） |
| `local-chrome` | `chromium.launch({ channel: 'chrome' })`（本机 Google Chrome） |

## 用户话术 → profile

| 用户说法 | profile / CLI |
|----------|----------------|
| 默认 / 执行功能测试 / 看操作 | （不写）→ `playwright-headed` |
| 本地 Chrome / 系统 Chrome / 和我浏览器一样 | `--profile local-chrome-headed` 或 `--local-chrome` |
| 无头 / headless / CI / 后台 | `--headless` 或 `--profile playwright-headless` |
| 本地 Chrome + 无头 | `--profile local-chrome-headless` |

## CLI

```bash
node scripts/run-functional-tests.mjs --limit 20
node scripts/run-functional-tests.mjs --local-chrome --limit 20
node scripts/run-functional-tests.mjs --headless --all
node scripts/run-functional-tests.mjs --profile local-chrome-headed --slow-mo 1000
```

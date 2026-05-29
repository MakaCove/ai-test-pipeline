# UI 测试 Profile 配置模板

各项目复制到 `test-artifacts/ui-test.config.json`。

## 规则（Agent 必须遵守）

| 维度 | 默认 | 用户明确指定时 |
|------|------|----------------|
| **浏览器** | Playwright 自带 Chromium | 本地 / 系统 Chrome → `local-chrome-*` profile |
| **有头/无头** | **有头**（可见窗口） | 用户说无头/headless/CI → `*-headless` 或 `--headless` |
| **窗口尺寸（有头）** | **启动即最大化** | 用户明确要求固定尺寸时再覆盖 |

未指定浏览器且未指定无头 → **`playwright-headed`**（自带 Chromium + 有头）。

有头模式默认遵循：`args: ["--start-maximized"]` + `viewport: null`。

## 配置示例

```json
{
  "defaultProfile": "playwright-headed",
  "profiles": {
    "playwright-headed": {
      "description": "默认：Playwright 自带 Chromium，有头",
      "engine": "playwright-chromium",
      "headed": true,
      "slowMo": 1000,
      "launchOptions": {
        "args": ["--start-maximized"]
      },
      "contextOptions": {
        "viewport": null
      }
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
      "slowMo": 800,
      "launchOptions": {
        "args": ["--start-maximized"]
      },
      "contextOptions": {
        "viewport": null
      }
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

## 最大化窗口约定（有头）

- 默认必须加启动参数：`--start-maximized`
- 默认必须使用：`contextOptions.viewport = null`（跟随窗口尺寸）
- 仅当用户明确指定窗口尺寸时，才允许覆盖为固定 `viewport`
- 无头模式不强调“最大化”，因为不存在可见窗口

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

## 可选：路由守卫关键词（非中文项目）

路由守卫专项用例可在用例上加结构化信号以放行其 `navigate`。
非中文项目可在本配置追加 `guardKeywords`，或在用例上加结构化信号
`"isRouteGuard": true` / `tags: ["route-guard"]`（语言无关，推荐）。

```json
{
  "defaultProfile": "playwright-headed",
  "guardKeywords": ["guard", "redirect", "unauthenticated"],
  "profiles": { }
}
```

选择器定位策略见 [选择器策略.md](选择器策略.md)。

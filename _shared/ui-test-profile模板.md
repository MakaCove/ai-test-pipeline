# UI 测试 Profile 配置模板

各项目复制到 `test-artifacts/ui-test.config.json`。

## 规则（Agent 必须遵守）

| 维度 | 默认 | 用户明确指定时 |
|------|------|----------------|
| **浏览器** | **自动**：固定 ms-playwright 缓存 → 系统 Chrome | `--local-chrome` 强制 Chrome；`--profile playwright-headed` 强制自带 Chromium |
| **有头/无头** | **有头**（可见窗口） | 用户说无头/headless/CI → `--headless` 或 `auto-headless` profile |
| **窗口尺寸（有头）** | **启动即最大化** | 用户明确要求固定尺寸时再覆盖 |

未指定浏览器且未指定无头 → **`auto-headed`**（自动解析 + 有头）。

有头模式默认遵循：`args: ["--start-maximized"]` + `viewport: null`。

## 浏览器解析优先级

执行器 `run-functional-tests.mjs` 按以下顺序解析（可通过 `browserResolve.preferEngine` 调整）：

1. **Playwright npm 包**：`browserResolve.playwrightModulePaths` → 当前项目 `node_modules` → 上级目录 → 技能包目录
2. **浏览器缓存**：`browserResolve.playwrightBrowsersPath` 或 `%LOCALAPPDATA%\ms-playwright`（设 `PLAYWRIGHT_BROWSERS_PATH`）
3. **引擎选择**（`engine: "auto"` 时）：
   - `fixed-chromium`：固定缓存中有匹配 revision 的 `chromium-*`
   - `system-chrome`：配置的 Chrome 路径或系统默认 Google Chrome
   - 兜底：Playwright 自带 Chromium（可能触发下载）

## 配置示例

```json
{
  "defaultProfile": "auto-headed",
  "browserResolve": {
    "playwrightBrowsersPath": "C:\\Users\\shian\\AppData\\Local\\ms-playwright",
    "playwrightModulePaths": [
      "C:\\Users\\shian\\node_modules\\playwright",
      "D:\\AI-File\\cursor\\test-case-demo\\node_modules\\playwright"
    ],
    "chromeExecutablePaths": [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    ],
    "preferEngine": ["fixed-chromium", "system-chrome"]
  },
  "profiles": {
    "auto-headed": {
      "description": "默认：自动解析浏览器 + 有头",
      "engine": "auto",
      "headed": true,
      "slowMo": 800,
      "launchOptions": {
        "args": ["--start-maximized"]
      },
      "contextOptions": {
        "viewport": null
      }
    },
    "auto-headless": {
      "description": "用户指定无头：自动解析浏览器",
      "engine": "auto",
      "headed": false,
      "slowMo": 0
    },
    "playwright-headed": {
      "description": "显式指定：Playwright 自带 Chromium，有头",
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
      "description": "显式指定：Playwright 自带 Chromium，无头",
      "engine": "playwright-chromium",
      "headed": false,
      "slowMo": 0
    },
    "local-chrome-headed": {
      "description": "显式指定：系统 Chrome，有头",
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
      "description": "显式指定：系统 Chrome + 无头",
      "engine": "local-chrome",
      "headed": false,
      "slowMo": 0
    }
  }
}
```

## browserResolve 字段

| 字段 | 说明 |
|------|------|
| `playwrightBrowsersPath` | 固定 ms-playwright 目录，避免重复下载 |
| `playwrightModulePaths` | 固定 Playwright npm 包路径（按顺序尝试） |
| `chromeExecutablePaths` | 固定 Chrome 可执行文件路径 |
| `preferEngine` | 引擎优先级，如 `["fixed-chromium", "system-chrome"]` |

环境变量 `PLAYWRIGHT_BROWSERS_PATH` 可覆盖浏览器缓存路径（配置文件未设时生效）。

## engine 字段

| engine | 实际启动 |
|--------|----------|
| `auto` | 按 `preferEngine` 自动选择 |
| `playwright-chromium` | `chromium.launch()`（`ms-playwright/chromium-*`） |
| `local-chrome` | `chromium.launch({ channel: 'chrome' })`（本机 Google Chrome） |

## 最大化窗口约定（有头）

- 默认必须加启动参数：`--start-maximized`
- 默认必须使用：`contextOptions.viewport = null`（跟随窗口尺寸）
- 仅当用户明确指定窗口尺寸时，才允许覆盖为固定 `viewport`
- 无头模式不强调「最大化」，因为不存在可见窗口

## 用户话术 → profile

| 用户说法 | profile / CLI |
|----------|----------------|
| 默认 / 执行功能测试 / 看操作 | （不写）→ `auto-headed` |
| 本地 Chrome / 系统 Chrome / 和我浏览器一样 | `--local-chrome` |
| 无头 / headless / CI / 后台 | `--headless` 或 `--profile auto-headless` |
| 本地 Chrome + 无头 | `--local-chrome --headless` |
| 强制 Playwright Chromium | `--profile playwright-headed` |

## CLI

```bash
node scripts/run-functional-tests.mjs --limit 20
node scripts/run-functional-tests.mjs --local-chrome --limit 20
node scripts/run-functional-tests.mjs --headless --all
node scripts/run-functional-tests.mjs --profile playwright-headed --slow-mo 1000
```

## 可选：路由守卫关键词（非中文项目）

路由守卫专项用例可在用例上加结构化信号以放行其 `navigate`。
非中文项目可在本配置追加 `guardKeywords`，或在用例上加结构化信号
`"isRouteGuard": true` / `tags: ["route-guard"]`（语言无关，推荐）。

```json
{
  "defaultProfile": "auto-headed",
  "guardKeywords": ["guard", "redirect", "unauthenticated"],
  "profiles": { }
}
```

选择器定位策略见 [选择器策略.md](选择器策略.md)。

# ui-test.config.json 模板

配置文件路径：`test-artifacts/ui-test.config.json`（与用例产物同级）。

本仓库已按本机路径写死 Playwright 与 Chrome 位置，**无需再下载**。

**默认有头 + 窗口最大化**：`defaultProfile` 为 `auto-headed`；有头时自动 `--start-maximized` 且 `viewport: null`（脚本层强制，配置可省略）。

## 字段说明

| 字段 | 含义 | 本机固定值 |
|------|------|------------|
| `playwrightBrowsersPath` | Playwright 浏览器二进制缓存 | `C:\Users\shian\AppData\Local\ms-playwright` |
| `playwrightModulePaths` | Node.js `playwright` npm 包目录 | `C:\Users\shian\node_modules\playwright` |
| `chromeExecutablePaths` | 系统 Chrome 可执行文件 | `C:\Program Files\Google\Chrome\Application\chrome.exe` |

> `ms-playwright` 是浏览器缓存，写到 `playwrightBrowsersPath`；npm 包写到 `playwrightModulePaths`，两者不要混用。

## 本机配置（直接使用）

仓库内已提供：`test-artifacts/ui-test.config.json`

```json
{
  "defaultProfile": "auto-headed",
  "profiles": {
    "auto-headed": { "engine": "auto", "headed": true, "slowMo": 500 },
    "auto-headless": { "engine": "auto", "headed": false, "slowMo": 0 }
  },
  "browserResolve": {
    "preferEngine": ["fixed-chromium", "system-chrome"],
    "playwrightBrowsersPath": "C:\\Users\\shian\\AppData\\Local\\ms-playwright",
    "playwrightModulePaths": [
      "C:\\Users\\shian\\node_modules\\playwright"
    ],
    "chromeExecutablePaths": [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    ]
  }
}
```

## 路径解析说明

- 配置从 `test-artifacts/ui-test.config.json` 读取（执行 `run-ui-tests.mjs` 时，`--artifacts-dir` 默认为 `./test-artifacts`）。
- `playwrightModulePaths` 使用**绝对路径**，不依赖当前工作目录，避免在不同项目目录执行时找不到包。

## 自检命令

```bash
node scripts/run-ui-tests.mjs --help
node scripts/run-ui-tests.mjs --limit 20
node scripts/run-ui-tests.mjs --local-chrome --limit 20
node scripts/run-ui-tests.mjs --headless --all
```

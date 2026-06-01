# ui-test.config.json 模板

```json
{
  "defaultProfile": "auto-headed",
  "profiles": {
    "auto-headed": {
      "engine": "auto",
      "headed": true,
      "slowMo": 500
    },
    "auto-headless": {
      "engine": "auto",
      "headed": false,
      "slowMo": 0
    }
  },
  "browserResolve": {
    "preferEngine": ["fixed-chromium", "system-chrome"],
    "playwrightModulePaths": [],
    "chromeExecutablePaths": []
  }
}
```

## 执行示例

```bash
node scripts/run-ui-tests.mjs --limit 20
node scripts/run-ui-tests.mjs --headless --all
```

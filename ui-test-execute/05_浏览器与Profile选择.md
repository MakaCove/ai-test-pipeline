# 05 — 浏览器与 Profile 选择

> Agent 执行 UI/功能测试前，**先解析用户指示**（浏览器来源 + 有头/无头 + 用例范围），再调用 `run-functional-tests.mjs`。

---

## 1. 两条默认规则（最重要）

| 维度 | **默认** | 用户明确指定时 |
|------|----------|----------------|
| 浏览器 | **Playwright 自带 Chromium** | 说「本地 Chrome / 系统 Chrome」→ 本机 Google Chrome |
| 显示模式 | **有头**（弹出窗口，可见操作） | 说「无头 / headless / CI」→ 无头 |
| 窗口尺寸（有头） | **启动即最大化** | 仅在用户明确要求固定尺寸时覆盖 |

**未写任何说明** → `playwright-headed`（自带 Chromium + 有头 + slowMo 1000 + 默认最大化）。

---

## 2. Profile 一览

配置：`test-artifacts/ui-test.config.json`

| profile | 浏览器 | 有头/无头 |
|---------|--------|-----------|
| **`playwright-headed`（默认）** | Playwright 自带 Chromium | 有头 |
| `playwright-headless` | Playwright 自带 Chromium | 无头 |
| `local-chrome-headed` | 系统 Google Chrome | 有头 |
| `local-chrome-headless` | 系统 Google Chrome | 无头 |

---

## 3. 用户话术 → 映射

| 用户说法 | 选用 |
|----------|------|
| 执行功能测试 / 跑用例 / 默认 / 看操作 | 不写 profile → **playwright-headed** |
| 本地 Chrome / 系统 Chrome / 和我浏览器一样 | `--local-chrome` 或 `--profile local-chrome-headed` |
| 无头 / headless / 后台 / CI | `--headless` 或 `--profile playwright-headless` |
| 本地 Chrome + 无头 | `--profile local-chrome-headless` |
| 前 N 条 | `--limit N` |
| 全部 | `--all` |

---

## 4. 标准 CLI

```bash
# 在包含 test-artifacts/ 的目录执行（scripts/ 与 test-artifacts/ 同级），不要 cd test-artifacts

# 默认：自带 Chromium + 有头
node scripts/run-functional-tests.mjs --limit 20

# 指定本地 Chrome + 有头
node scripts/run-functional-tests.mjs --local-chrome --limit 20

# 指定无头（仍用自带 Chromium，除非同时指定 local-chrome）
node scripts/run-functional-tests.mjs --headless --limit 20

# 本地 Chrome + 无头
node scripts/run-functional-tests.mjs --profile local-chrome-headless --all
```

## 4.1 有头默认最大化约定

- `playwright-headed` 与 `local-chrome-headed` 默认都应使用：
  - `launchOptions.args: ["--start-maximized"]`
  - `contextOptions.viewport: null`
- 若用户明确指定窗口尺寸（例如 1366x768），再改为固定 `viewport`

---

## 5. 执行通道

- **批量 JSON 用例** → Playwright 脚本（禁止 MCP 替代）
- **单页探索** → MCP Browser

---

## 6. 报告须记录

`profile`、`engine`（playwright-chromium / local-chrome）、有头/无头、`slowMo`。

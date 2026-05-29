---
name: api-test-execute
description: 读取接口测试用例生成器输出的 JSON 用例文件，逐条发送 HTTP 请求并验证响应断言，最终生成 Markdown 格式的接口测试报告。当用户要求执行接口测试、运行 API 测试或验证后端接口时使用此技能。
disable-model-invocation: true
---

# 接口测试执行器

读取 `api-test-case-generate` 生成的 JSON 用例文件，逐条发送 HTTP 请求并验证响应，生成 Markdown 测试报告。

## 快速开始

1. 定位最新的接口用例文件。
2. 确认后端服务运行中。
3. 按顺序执行所有用例。
4. 生成报告写入 `test-artifacts/api-reports/`。

## 详细指南

- [01_范围定义.md](01_范围定义.md) — 执行范围与前置条件
- [02_执行工作流.md](02_执行工作流.md) — 完整执行工作流
- [03_结果判定规则.md](03_结果判定规则.md) — 结果判定与报告规则
- [04_完整示例.md](04_完整示例.md) — 完整示例

---
name: api-test-case-generate
description: 基于 project-analysis 与 Controller/DTO/异常处理，先建立端点契约清单再推导接口测试用例。适用任意 REST 项目；以契约覆盖率为交付标准，不以用例条数为 KPI。
disable-model-invocation: true
---

# 接口测试用例生成器

**核心原则：用例来自端点契约与业务规则，而不是 2.5×N 条数公式。**

输出符合 `_shared/接口用例结构.md` 的 JSON。交付标准是 **端点 100% 覆盖 + 契约场景覆盖完整 + 断言可执行 + 链路可复用**，不是「达到 N 条」。

## 前置（优先）

1. **优先**运行 **project-analyzer**。
2. 若 `project-analysis` 不可用，回退为：直接扫描 Controller/DTO/异常处理源码与 OpenAPI（若有），并在产物中注明回退来源。
3. 阅读 **[08_端点契约驱动设计.md](08_端点契约驱动设计.md)**（方法论核心）。
4. 阅读 **[09_接口数据链路驱动设计.md](09_接口数据链路驱动设计.md)**（通用上下游链路规则）。
5. 阅读 **[07_接口测试用例设计方法.md](07_接口测试用例设计方法.md)** 与 **[06_契约覆盖与验收标准.md](06_契约覆盖与验收标准.md)**。

## 做什么 / 不做什么

| ✅ 做 | ❌ 不做 |
|------|--------|
| 读 Controller、DTO、`GlobalExceptionHandler` 建契约清单 | 只读端点清单就套 H/V/A/E 模板 |
| 每个契约场景 1 条用例，`contractRef` 可追溯 | `pool[i % len(pool)]` 轮换 tag 凑数 |
| 按真实字段名、错误码写 body 与断言 | 统一 sample_body 臆造字段 |
| 变量链按业务依赖编排 | 写死 projectId=1 |
| 对所有可串联场景建立“上游产出→下游消费”链路 | 把有依赖关系的端点拆成孤立用例 |
| 元信息输出 `endpointContracts` + 场景覆盖 | 以 `targetMinCases ≥ 2.5N` 验收 |

## 执行顺序（摘要）

1. 读 `project-analysis` + 相关 Controller/DTO。
2. **逐端点建立契约清单**（08）。
3. 对可串联场景建立**数据链路图**（09）：定义生产者端点与消费者端点。
4. 对每个契约场景用 07 设计方法写用例。
5. 编排 login → 创建 → 查询 → 动作 → 清理顺序，并补充 `dependsOnCases` / `produces` / `consumes`。
5. 验收：**endpointCoverage 100%** + **contractScenarioCoverage 100%（P0）**。
6. 写入 `test-artifacts/api-cases/api-cases-{时间戳}.json`。

## 详细指南

- [01_范围定义.md](01_范围定义.md)
- [02_执行工作流.md](02_执行工作流.md)
- [03_用例设计规则.md](03_用例设计规则.md)
- [04_输出规范.md](04_输出规范.md)
- [05_完整示例.md](05_完整示例.md)
- [06_契约覆盖与验收标准.md](06_契约覆盖与验收标准.md)
- [07_接口测试用例设计方法.md](07_接口测试用例设计方法.md)
- **[08_端点契约驱动设计.md](08_端点契约驱动设计.md)** ← 必读
- **[09_接口数据链路驱动设计.md](09_接口数据链路驱动设计.md)** ← 必读

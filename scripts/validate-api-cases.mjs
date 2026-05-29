#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SCHEMA = "ai-test-pipeline/api-case/v1";
const CASE_ID_REGEX = /^TC-API-[A-Z0-9-]+$/;
const HELP_TEXT = `用法:
  node scripts/validate-api-cases.mjs [文件路径] [--strict] [--enforce-chain]
  node scripts/validate-api-cases.mjs [--strict] [--enforce-chain] [文件路径]

选项:
  --strict         将 warning 也视为失败（退出码 1）
  --enforce-chain  识别到可串联场景时，若无链路用例则失败
  -h, --help       显示帮助
`;

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveInputFile(argvPath) {
  if (argvPath) {
    return path.resolve(process.cwd(), argvPath);
  }

  const latestPath = path.resolve(process.cwd(), "test-artifacts", "latest");
  const casesDir = path.resolve(process.cwd(), "test-artifacts", "api-cases");

  if (fileExists(latestPath)) {
    const ts = fs.readFileSync(latestPath, "utf8").trim();
    if (ts) {
      const candidate = path.join(casesDir, `api-cases-${ts}.json`);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }

  if (!fileExists(casesDir)) {
    throw new Error("未找到 test-artifacts/api-cases 目录，也没有传入文件路径。");
  }

  const files = fs
    .readdirSync(casesDir)
    .filter((name) => /^api-cases-.*\.json$/.test(name))
    .map((name) => ({
      fullPath: path.join(casesDir, name),
      mtimeMs: fs.statSync(path.join(casesDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error("api-cases 目录下没有找到 api-cases-*.json 文件。");
  }

  return files[0].fullPath;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const strictMode = args.includes("--strict");
  const enforceChainMode = args.includes("--enforce-chain");
  const inputArg = args.find((arg) => !arg.startsWith("-"));

  const issues = [];
  const warnings = [];
  const addIssue = (category, message, caseId = null) => issues.push({ category, message, caseId });
  const addWarning = (category, message, caseId = null) => warnings.push({ category, message, caseId });

  let filePath;
  let payload;
  try {
    filePath = resolveInputFile(inputArg);
    payload = readJson(filePath);
  } catch (error) {
    console.error(`❌ 读取失败: ${error.message}`);
    process.exit(1);
  }

  if (!Array.isArray(payload)) {
    addIssue("结构错误", "顶层必须是数组。");
    return finish(filePath, strictMode, enforceChainMode, 0, issues, warnings);
  }
  if (payload.length < 2) {
    addIssue("结构错误", "顶层数组长度必须 >= 2（meta + 至少 1 条用例）。");
    return finish(filePath, strictMode, enforceChainMode, 0, issues, warnings);
  }

  const meta = payload[0];
  const cases = payload.slice(1);
  const coverage = meta?.coverage;

  if (meta?.schema !== SCHEMA) {
    addIssue("结构错误", `schema 必须为 "${SCHEMA}"。`);
  }

  const requiredCoverageKeys = [
    "endpointTotal",
    "endpointsCovered",
    "contractScenarioTotal",
    "contractScenariosCovered",
    "contractScenarioCoveragePercent",
    "endpointContracts",
  ];
  if (!coverage || typeof coverage !== "object") {
    addIssue("结构错误", "meta.coverage 缺失或不是对象。");
  } else {
    for (const key of requiredCoverageKeys) {
      if (!(key in coverage)) {
        addIssue("结构错误", `meta.coverage 缺少必填字段: ${key}`);
      }
    }
  }

  const endpointContracts = Array.isArray(coverage?.endpointContracts) ? coverage.endpointContracts : [];
  const contractIdSet = new Set(endpointContracts.map((item) => item?.id).filter(Boolean));
  const contractById = new Map();
  const scenarioByContract = new Map();
  for (const contract of endpointContracts) {
    if (contract?.id) {
      contractById.set(contract.id, contract);
      const scenarioIds = Array.isArray(contract?.scenarios)
        ? contract.scenarios.map((s) => s?.id).filter(Boolean)
        : [];
      scenarioByContract.set(contract.id, new Set(scenarioIds));
    }
  }

  const p0ScenarioKeys = new Set();
  for (const contract of endpointContracts) {
    const isP0 = contract?.priority === "P0";
    const scenarioIds = Array.isArray(contract?.scenarios) ? contract.scenarios.map((s) => s?.id).filter(Boolean) : [];
    for (const sid of scenarioIds) {
      if (isP0) p0ScenarioKeys.add(`${contract.id}::${sid}`);
    }
  }

  const allCaseIds = new Set(cases.map((item) => item?.id).filter(Boolean));
  const producesByCaseId = new Map();
  for (const item of cases) {
    const arr = Array.isArray(item?.produces) ? item.produces.filter((v) => typeof v === "string" && v.trim() !== "") : [];
    if (item?.id) producesByCaseId.set(item.id, arr);
  }

  const seenCaseIds = new Set();
  const coveredP0ScenarioKeys = new Set();
  let computedOrphanCases = 0;
  let chainCaseCount = 0;

  const moduleMethods = new Map();
  for (const contract of endpointContracts) {
    const module = contract?.module;
    const method = String(contract?.method || "").toUpperCase();
    if (!module || !method) continue;
    if (!moduleMethods.has(module)) moduleMethods.set(module, new Set());
    moduleMethods.get(module).add(method);
  }
  const potentialChainModules = [];
  for (const [module, methods] of moduleMethods.entries()) {
    const hasProducer = methods.has("POST");
    const hasConsumer = methods.has("GET") || methods.has("PUT") || methods.has("PATCH") || methods.has("DELETE");
    if (hasProducer && hasConsumer) potentialChainModules.push(module);
  }

  for (const testCase of cases) {
    const caseId = testCase?.id ?? "(无ID)";

    if (!testCase?.id) {
      addIssue("结构错误", "存在缺失 id 的用例对象。");
    } else if (seenCaseIds.has(testCase.id)) {
      addIssue("质量不达标", `用例 id 重复: ${testCase.id}`, caseId);
    } else {
      seenCaseIds.add(testCase.id);
      if (!CASE_ID_REGEX.test(testCase.id)) {
        addWarning("质量建议", `用例 id 建议匹配 ${CASE_ID_REGEX.toString()}`, caseId);
      }
    }

    const hasContractRef = typeof testCase?.contractRef === "string" && testCase.contractRef.trim() !== "";
    const hasContractRefs =
      Array.isArray(testCase?.contractRefs) &&
      testCase.contractRefs.filter((item) => typeof item === "string" && item.trim() !== "").length > 0;
    const scenarioRef = typeof testCase?.scenarioRef === "string" && testCase.scenarioRef.trim() !== "" ? testCase.scenarioRef : "";

    if (!scenarioRef) {
      addIssue("追溯缺失", "用例必须包含 scenarioRef。", caseId);
      computedOrphanCases += 1;
    }
    if (!hasContractRef && !hasContractRefs) {
      addIssue("追溯缺失", "用例必须包含 contractRef 或非空 contractRefs。", caseId);
      computedOrphanCases += 1;
    }
    if (Array.isArray(testCase?.contractRefs) && testCase.contractRefs.length === 0) {
      addIssue("追溯缺失", "contractRefs 为空数组，存在该字段时必须为非空。", caseId);
      computedOrphanCases += 1;
    }

    const refs = [];
    if (hasContractRef) refs.push(testCase.contractRef);
    if (hasContractRefs) refs.push(...testCase.contractRefs);

    for (const ref of refs) {
      if (!contractIdSet.has(ref)) {
        addIssue("追溯缺失", `引用的契约不存在于 endpointContracts: ${ref}`, caseId);
        continue;
      }
      const scenarios = scenarioByContract.get(ref);
      if (scenarioRef && scenarios && !scenarios.has(scenarioRef) && !scenarioRef.startsWith("SCN-WF-")) {
        addIssue("追溯缺失", `scenarioRef 未在契约 ${ref} 的 scenarios 中找到: ${scenarioRef}`, caseId);
      }
      const key = `${ref}::${scenarioRef}`;
      if (p0ScenarioKeys.has(key)) coveredP0ScenarioKeys.add(key);
    }

    const dependsOnCases = Array.isArray(testCase?.dependsOnCases)
      ? testCase.dependsOnCases.filter((item) => typeof item === "string" && item.trim() !== "")
      : [];
    const produces = Array.isArray(testCase?.produces)
      ? testCase.produces.filter((item) => typeof item === "string" && item.trim() !== "")
      : [];
    const consumes = Array.isArray(testCase?.consumes)
      ? testCase.consumes.filter((item) => typeof item === "string" && item.trim() !== "")
      : [];
    const isChainCase = hasContractRefs || dependsOnCases.length > 0 || produces.length > 0 || consumes.length > 0;
    if (isChainCase) chainCaseCount += 1;

    if (Array.isArray(testCase?.dependsOnCases) && testCase.dependsOnCases.length === 0) {
      addIssue("链路缺失", "dependsOnCases 为空数组，存在该字段时必须为非空。", caseId);
    }
    for (const depId of dependsOnCases) {
      if (!allCaseIds.has(depId)) {
        addIssue("链路缺失", `dependsOnCases 引用了不存在的上游用例: ${depId}`, caseId);
      }
    }

    const availableFromDeps = new Set();
    for (const depId of dependsOnCases) {
      const produced = producesByCaseId.get(depId) || [];
      for (const variable of produced) availableFromDeps.add(variable);
    }
    for (const variable of consumes) {
      if (!produces.includes(variable) && !availableFromDeps.has(variable)) {
        addIssue("链路缺失", `consumes 变量未在当前用例 produces 或 dependsOnCases 上游产出中找到: ${variable}`, caseId);
      }
    }

    if (!testCase?.module || String(testCase.module).trim() === "") {
      addIssue("质量不达标", "module 不能为空。", caseId);
    }

    const request = testCase?.request;
    const assertions = Array.isArray(testCase?.assertions) ? testCase.assertions : [];
    if (!request || typeof request !== "object" || Object.keys(request).length === 0) {
      addIssue("质量不达标", "request 不得为空对象。", caseId);
    }
    if (assertions.length < 2) {
      addIssue("质量不达标", "assertions 至少需要 2 条。", caseId);
    }

    const reqBody = request?.body;
    if (reqBody && typeof reqBody === "object") {
      const user = String(reqBody?.username ?? "");
      const pass = String(reqBody?.password ?? "");
      if (user.toLowerCase() === "admin" || pass.toLowerCase() === "123admin") {
        addIssue("硬编码风险", "检测到默认账号口令硬编码。", caseId);
      }
      if (user && /username/i.test(JSON.stringify(reqBody)) && !/\{\{username\}\}/.test(user) && user !== "{{username}}") {
        addWarning("质量建议", "登录用户名建议使用 {{username}} 占位。", caseId);
      }
      if (pass && /password/i.test(JSON.stringify(reqBody)) && !/\{\{password\}\}/.test(pass) && pass !== "{{password}}") {
        addWarning("质量建议", "登录密码建议使用 {{password}} 占位。", caseId);
      }
      const bodyText = JSON.stringify(reqBody);
      if (/name|code/i.test(bodyText) && !/\{\{timestamp\}\}/.test(bodyText)) {
        addWarning("质量建议", "创建类请求建议使用 {{timestamp}} 避免唯一键冲突。", caseId);
      }
    }
  }

  if (coverage && typeof coverage === "object") {
    const {
      endpointTotal,
      endpointsCovered,
      endpointCoveragePercent,
      contractScenarioTotal,
      contractScenariosCovered,
      contractScenarioCoveragePercent,
      uncoveredScenarios,
      orphanCases,
      flowChains,
    } = coverage;

    if (Number.isFinite(endpointTotal) && endpointTotal > 0 && Number.isFinite(endpointsCovered)) {
      const expected = Math.round((endpointsCovered / endpointTotal) * 100);
      if (Number(endpointCoveragePercent) !== expected) {
        addIssue("覆盖不足", `endpointCoveragePercent 不一致，期望 ${expected}，实际 ${endpointCoveragePercent}`);
      }
    }
    if (Number.isFinite(contractScenarioTotal) && contractScenarioTotal > 0 && Number.isFinite(contractScenariosCovered)) {
      const expected = Math.round((contractScenariosCovered / contractScenarioTotal) * 100);
      if (Number(contractScenarioCoveragePercent) !== expected) {
        addIssue("覆盖不足", `contractScenarioCoveragePercent 不一致，期望 ${expected}，实际 ${contractScenarioCoveragePercent}`);
      }
    }
    if (Array.isArray(uncoveredScenarios) && uncoveredScenarios.length > 0) {
      addIssue("覆盖不足", `uncoveredScenarios 必须为空，当前 ${uncoveredScenarios.length} 项。`);
    }
    if (Number.isFinite(orphanCases) && orphanCases !== 0) {
      addIssue("追溯缺失", `coverage.orphanCases 必须为 0，当前为 ${orphanCases}。`);
    }
    if (Number.isFinite(orphanCases) && orphanCases !== computedOrphanCases) {
      addIssue("追溯缺失", `coverage.orphanCases 与实算不一致（meta=${orphanCases}, computed=${computedOrphanCases}）。`);
    }

    if (flowChains && typeof flowChains === "object") {
      const { chainScenarioTotal, chainScenarioCovered, chainScenarioCoveragePercent } = flowChains;
      if (
        Number.isFinite(chainScenarioTotal) &&
        chainScenarioTotal > 0 &&
        Number.isFinite(chainScenarioCovered) &&
        Number.isFinite(chainScenarioCoveragePercent)
      ) {
        const expected = Math.round((chainScenarioCovered / chainScenarioTotal) * 100);
        if (Number(chainScenarioCoveragePercent) !== expected) {
          addIssue("链路缺失", `flowChains.chainScenarioCoveragePercent 不一致，期望 ${expected}，实际 ${chainScenarioCoveragePercent}`);
        }
      }
    }
  }

  for (const key of p0ScenarioKeys) {
    if (!coveredP0ScenarioKeys.has(key)) {
      addIssue("覆盖不足", `P0 契约场景未覆盖: ${key}`);
    }
  }

  if (enforceChainMode) {
    const chainScenarioTotal = coverage?.flowChains?.chainScenarioTotal;
    const hasDeclaredChain = Number.isFinite(chainScenarioTotal) && Number(chainScenarioTotal) > 0;
    const hasInferredChain = potentialChainModules.length > 0;
    if ((hasDeclaredChain || hasInferredChain) && chainCaseCount === 0) {
      const reason = hasDeclaredChain ? `flowChains.chainScenarioTotal=${chainScenarioTotal}` : `推断可串联模块: ${potentialChainModules.join(", ")}`;
      addIssue("链路缺失", `启用 --enforce-chain 时要求至少 1 条链路用例，当前为 0（依据：${reason}）。`);
    }
    if (hasInferredChain && !coverage?.flowChains) {
      addWarning("质量建议", "检测到可串联模块，建议补充 coverage.flowChains。");
    }
  }

  finish(filePath, strictMode, enforceChainMode, chainCaseCount, issues, warnings);
}

function finish(filePath, strictMode, enforceChainMode, chainCaseCount, issues, warnings) {
  console.log(`\n📄 文件: ${filePath}`);
  const modeParts = [strictMode ? "strict（warning 将导致失败）" : "normal"];
  if (enforceChainMode) modeParts.push("enforce-chain（链路门禁开启）");
  console.log(`🔒 模式: ${modeParts.join(" + ")}`);
  console.log(`🔗 链路用例: ${chainCaseCount}`);
  console.log(`⚠️  警告: ${warnings.length}`);
  console.log(`❌ 错误: ${issues.length}\n`);

  const printGroup = (title, list) => {
    if (list.length === 0) return;
    console.log(`${title}:`);
    for (const item of list) {
      const prefix = item.caseId ? `  - [${item.caseId}]` : "  -";
      console.log(`${prefix} ${item.message}`);
    }
    console.log("");
  };

  const categories = ["结构错误", "覆盖不足", "追溯缺失", "链路缺失", "质量不达标", "硬编码风险"];
  for (const category of categories) {
    printGroup(category, issues.filter((it) => it.category === category));
  }
  printGroup("质量建议", warnings);

  if (issues.length > 0) {
    console.log("❌ 校验失败：请按分类修复后重试。");
    process.exit(1);
  }
  if (strictMode && warnings.length > 0) {
    console.log("❌ 严格模式失败：存在 warning，请先修复后重试。");
    process.exit(1);
  }
  console.log("✅ 校验通过：api-cases 文件符合当前机检规则。");
  process.exit(0);
}

main();

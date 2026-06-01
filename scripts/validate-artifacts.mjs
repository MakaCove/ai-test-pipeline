#!/usr/bin/env node
/**
 * validate-artifacts.mjs — 产物轻量校验器
 */

import fs from "node:fs";
import path from "node:path";

const V1_FIELDS = ["dependsOnCases", "consumes", "produces", "flowRef", "featureRefs", "featureRef", "contractRef", "scenarioRef"];

function parseArgs(argv) {
  const opts = { artifactsDir: "test-artifacts", type: "all", file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "--artifacts-dir") opts.artifactsDir = argv[++i];
    else if (a === "--type") opts.type = argv[++i];
    else if (a === "--file") opts.file = argv[++i];
  }
  return opts;
}

const HELP = `用法:
  node scripts/validate-artifacts.mjs [选项]

选项:
  --artifacts-dir <dir>  产物根目录（默认 ./test-artifacts）
  --type <api|ui|all>    校验类型（默认 all）
  --file <path>          直接指定单个用例文件
  -h, --help             显示帮助
`;

function fileExists(p) {
  try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; }
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function latestCaseFile(root, dirName, pattern) {
  const dir = path.join(root, dirName);
  if (!fileExists(dir)) return null;
  const latestPath = path.join(root, "latest");
  if (fileExists(latestPath)) {
    const ts = fs.readFileSync(latestPath, "utf8").trim();
    const candidate = path.join(dir, pattern.replace("{ts}", ts));
    if (fileExists(candidate)) return candidate;
  }
  const files = fs.readdirSync(dir)
    .filter((n) => new RegExp(`^${pattern.replace("{ts}", ".*").replace(".", "\\.")}$`).test(n))
    .map((n) => ({ full: path.join(dir, n), m: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0]?.full || null;
}

function pushErr(list, file, moduleName, caseId, fieldPath, message) {
  list.push(`[${path.basename(file)}][${moduleName || "unknown"}][${caseId || "unknown"}][${fieldPath}] ${message}`);
}

function validateCommon(file, payload, schemaNeedle) {
  const errors = [];
  if (!Array.isArray(payload) || payload.length < 2) {
    pushErr(errors, file, "meta", "meta", "root", "顶层必须是 [meta, ...cases]");
    return { errors, meta: null, cases: [] };
  }
  const meta = payload[0];
  const cases = payload.slice(1);
  if (!meta?.schema || !String(meta.schema).includes(schemaNeedle)) {
    pushErr(errors, file, "meta", "meta", "schema", `schema 必须包含 ${schemaNeedle}`);
  }
  if (!meta?.generatedAt) {
    pushErr(errors, file, "meta", "meta", "generatedAt", "缺少生成时间");
  }
  const ids = new Set();
  for (const c of cases) {
    if (!c?.id) {
      pushErr(errors, file, c?.module, c?.id, "id", "缺少 id");
      continue;
    }
    if (ids.has(c.id)) {
      pushErr(errors, file, c.module, c.id, "id", "id 重复");
    }
    ids.add(c.id);
    if (!c.module) pushErr(errors, file, c.module, c.id, "module", "缺少 module");
    if (!c.priority) pushErr(errors, file, c.module, c.id, "priority", "缺少 priority");
    for (const f of V1_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(c, f)) {
        pushErr(errors, file, c.module, c.id, f, "检测到无效字段，仅支持 trace.*");
      }
    }
    if (!c.trace || typeof c.trace !== "object") {
      pushErr(errors, file, c.module, c.id, "trace", "缺少 trace 对象");
      continue;
    }
    if (!Array.isArray(c.trace.flowRefs) || c.trace.flowRefs.length === 0) {
      pushErr(errors, file, c.module, c.id, "trace.flowRefs", "必须是非空数组");
    }
    if (c.trace.dependsOn && !Array.isArray(c.trace.dependsOn)) {
      pushErr(errors, file, c.module, c.id, "trace.dependsOn", "必须是数组");
    }
    if (c.trace.consumes && !Array.isArray(c.trace.consumes)) {
      pushErr(errors, file, c.module, c.id, "trace.consumes", "必须是数组");
    }
    if (c.trace.produces && !Array.isArray(c.trace.produces)) {
      pushErr(errors, file, c.module, c.id, "trace.produces", "必须是数组");
    }
  }
  return { errors, meta, cases };
}

function validateApiFile(file) {
  const payload = readJson(file);
  const { errors, cases } = validateCommon(file, payload, "api-case/v2");
  const idSet = new Set(cases.map((c) => c.id));
  for (const c of cases) {
    if (!c.request || typeof c.request !== "object") {
      pushErr(errors, file, c.module, c.id, "request", "缺少 request");
    } else {
      if (!c.request.method) pushErr(errors, file, c.module, c.id, "request.method", "缺少 method");
      if (!c.request.path) pushErr(errors, file, c.module, c.id, "request.path", "缺少 path");
    }
    if (!Array.isArray(c.assertions) || c.assertions.length === 0) {
      pushErr(errors, file, c.module, c.id, "assertions", "必须是非空数组");
    }
    for (const depId of c.trace?.dependsOn || []) {
      if (!idSet.has(depId)) pushErr(errors, file, c.module, c.id, "trace.dependsOn", `引用不存在：${depId}`);
    }
  }
  return errors;
}

function validateUiFile(file) {
  const payload = readJson(file);
  const { errors, cases } = validateCommon(file, payload, "ui-case/v2");
  const idSet = new Set(cases.map((c) => c.id));
  for (const c of cases) {
    if (!Array.isArray(c.steps) || c.steps.length === 0) {
      pushErr(errors, file, c.module, c.id, "steps", "必须是非空数组");
    }
    if (!Array.isArray(c.assertions) || c.assertions.length === 0) {
      pushErr(errors, file, c.module, c.id, "assertions", "必须是非空数组");
    }
    for (const depId of c.trace?.dependsOn || []) {
      if (!idSet.has(depId)) pushErr(errors, file, c.module, c.id, "trace.dependsOn", `引用不存在：${depId}`);
    }
  }
  return errors;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  const root = path.resolve(process.cwd(), opts.artifactsDir);
  const files = [];
  if (opts.file) {
    files.push(path.resolve(process.cwd(), opts.file));
  } else {
    if (opts.type === "all" || opts.type === "api") {
      const api = latestCaseFile(root, "api-cases", "api-cases-{ts}.json");
      if (api) files.push(api);
    }
    if (opts.type === "all" || opts.type === "ui") {
      const ui = latestCaseFile(root, "ui-cases", "ui-cases-{ts}.json");
      if (ui) files.push(ui);
    }
  }

  if (files.length === 0) {
    console.error("❌ 未找到可校验的用例文件。请检查 test-artifacts 或传入 --file。");
    process.exit(1);
  }

  const allErrors = [];
  for (const file of files) {
    if (!fileExists(file)) {
      allErrors.push(`[${file}] 文件不存在`);
      continue;
    }
    try {
      if (file.includes("api-cases")) {
        allErrors.push(...validateApiFile(file));
      } else if (file.includes("ui-cases")) {
        allErrors.push(...validateUiFile(file));
      } else {
        allErrors.push(`[${file}] 无法推断用例类型，请放在 api-cases 或 ui-cases 目录`);
      }
    } catch (err) {
      allErrors.push(`[${file}] JSON 解析或校验异常：${err.message}`);
    }
  }

  if (allErrors.length > 0) {
    console.error("❌ 校验失败：");
    for (const e of allErrors) console.error(`- ${e}`);
    process.exit(1);
  }
  console.log(`✅ 校验通过，共 ${files.length} 个文件。`);
}

main();

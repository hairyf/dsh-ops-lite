import { createRequire } from "node:module";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
//#region src/constants.ts
const PACKAGE_NAME = "dsh-ops-lite";
const OFFICIAL_TOOLS = [
	"read",
	"write",
	"edit",
	"glob",
	"grep",
	"bash",
	"pwsh",
	"pwsh_persistent"
];
const OFFICIAL_TOOL_SECTIONS = [
	"tool:read",
	"tool:write",
	"tool:edit",
	"tool:glob",
	"tool:grep",
	"tool:bash",
	"tool:pwsh"
];
const OFFICIAL_TOOLS_DESCRIPTION = "开启后禁用官方基础文件与 Shell 工具，保留 read_image，不改变权限或沙箱。";
const DEFAULT_CONFIG = { disableOfficialTools: true };
//#endregion
//#region package.json
var version = "0.1.3";
var optionalDependencies = {
	"@dshopslite/darwin-arm64": "workspace:*",
	"@dshopslite/linux-x64": "workspace:*",
	"@dshopslite/win32-x64": "workspace:*"
};
//#endregion
//#region src/ops/binary.js
/** Resolve explicit selections or the exact OS/CPU runtime supplied by npm. */
/** Bundled host modules and development runtime assets live directly in dist. */
const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BINARY_ENV = "DSH_OPS_FASTCTX_BIN";
function runtimeRoot({ packageRoot = PACKAGE_ROOT, platform = process.platform, arch = process.arch } = {}) {
	const target = `${platform}-${arch}`;
	const name = `@dshopslite/${target}`;
	if (!Object.hasOwn(optionalDependencies, name)) throw new Error(`Unsupported dsh-ops-lite runtime target ${target}. No download or compilation fallback is used.`);
	if (fs.existsSync(path.join(packageRoot, "runtime", target, "provenance.json"))) return packageRoot;
	let file;
	try {
		file = createRequire(path.join(packageRoot, "package.json")).resolve(`${name}/package.json`);
	} catch (error) {
		throw new Error(`Runtime package ${name}@${version} is unavailable. Install dsh-ops-lite with optional dependencies enabled for a supported OS/CPU. No download or compilation fallback is used.`, { cause: error });
	}
	const installed = JSON.parse(fs.readFileSync(file, "utf8"));
	if (installed.name !== name || installed.version !== version || !Array.isArray(installed.os) || !installed.os.includes(platform) || !Array.isArray(installed.cpu) || !installed.cpu.includes(arch)) throw new Error(`Runtime package metadata mismatch: ${name}@${version}`);
	return path.dirname(file);
}
var BinaryNotFoundError = class extends Error {
	constructor(message, tried) {
		super(message);
		this.name = "BinaryNotFoundError";
		this.tried = tried;
	}
	report() {
		return this.tried.map((candidate) => `  - ${candidate.source}: ${candidate.file} (${candidate.detail})`).join("\n");
	}
};
function executableName(platform = process.platform) {
	return platform === "win32" ? "fastctx.exe" : "fastctx";
}
function describeFile(file) {
	try {
		return fs.statSync(file).isFile() ? "exists" : "not a regular file";
	} catch (error) {
		return error.code === "ENOENT" ? "missing" : String(error.message ?? error);
	}
}
/** Explicit choices are authoritative; missing platform packages never use ambient binaries. */
function resolveBinary({ binaryPath, packageRoot = PACKAGE_ROOT, env = process.env, platform = process.platform, arch = process.arch } = {}) {
	const tried = [];
	for (const [selected, source] of [[binaryPath, "config.binaryPath"], [env[BINARY_ENV], BINARY_ENV]]) {
		if (selected === void 0 || source === "DSH_OPS_FASTCTX_BIN" && selected.trim() === "") continue;
		const file = source === "DSH_OPS_FASTCTX_BIN" ? path.resolve(selected) : selected;
		const detail = describeFile(file);
		tried.push({
			file,
			source,
			detail
		});
		if (detail !== "exists") throw new BinaryNotFoundError(`${source} does not name an existing file: ${file}`, tried);
		return {
			file,
			source,
			tried
		};
	}
	const file = path.join(runtimeRoot({
		packageRoot,
		platform,
		arch
	}), "runtime", `${platform}-${arch}`, executableName(platform));
	const detail = describeFile(file);
	tried.push({
		file,
		source: "bundled runtime",
		detail
	});
	if (detail !== "exists") throw new BinaryNotFoundError(`FastCtx is missing from the ${platform}-${arch} runtime package. Reinstall with optional dependencies enabled.`, tried);
	const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "fastctx.provenance.json"), "utf8"));
	if (receipt.target !== `${platform}-${arch}` || receipt.version !== "0.2.6" || receipt.executable !== executableName(platform) || receipt.sha256 !== createHash("sha256").update(fs.readFileSync(file)).digest("hex")) throw new Error("FastCtx provenance mismatch.");
	return {
		file,
		source: "bundled runtime",
		tried
	};
}
function probeBinary(file, { timeoutMs = 15e3, env = process.env } = {}) {
	const result = spawnSync(file, ["--version"], {
		encoding: "utf8",
		timeout: timeoutMs,
		windowsHide: true,
		env
	});
	if (result.error !== void 0 && result.error !== null) return {
		ok: false,
		detail: String(result.error.message ?? result.error)
	};
	if (result.status !== 0) {
		const stderr = (result.stderr ?? "").trim().split("\n")[0] ?? "";
		return {
			ok: false,
			detail: `exited ${result.status}${stderr === "" ? "" : `: ${stderr}`}`
		};
	}
	return {
		ok: true,
		version: (result.stdout ?? "").trim().split("\n")[0] ?? ""
	};
}
//#endregion
//#region src/ops/policy.js
/** Model-facing routing, kept in one section. No shared registry mutation. */
const TOOLING_SECTION = "dsh-ops:repository-tooling";
const SECTION_ORDERS = Object.freeze({ [TOOLING_SECTION]: 3250 });
const TOOL_PREFIX = "ops_";
const FILE_TOOLS = Object.freeze([
	"inspect_local_file",
	"grep",
	"glob",
	"replace"
]);
const BACKGROUND_TOOLS = Object.freeze([
	"run_background",
	"job_output",
	"job_list",
	"job_kill"
]);
const SHELL_TOOLS = Object.freeze(["run", ...BACKGROUND_TOOLS]);
const IN_PROCESS_TOOLS = Object.freeze(["bash"]);
function publicToolName(rawName) {
	return `${TOOL_PREFIX}${rawName}`;
}
const BASH_TOOL = publicToolName("bash");
/** A single compact table; absent tools never get advertised. */
function renderToolingPolicy({ published, enableShellTools, mounted, levels, pwsh7 = false, shellComponent = true, extraGuidance = "" }) {
	const names = new Set(published ?? (mounted || levels?.fastctx ? [
		...FILE_TOOLS,
		...enableShellTools ? SHELL_TOOLS : [],
		...levels?.bash ? IN_PROCESS_TOOLS : []
	].map(publicToolName) : []));
	if (levels?.pwsh) names.add("pwsh");
	if (!shellComponent) names.delete("pwsh");
	const hasFiles = FILE_TOOLS.some((name) => names.has(publicToolName(name)));
	const hasBash = names.has(BASH_TOOL);
	const hasBackground = names.has(publicToolName("run_background"));
	const hasPwsh = shellComponent && names.has("pwsh");
	if (!hasFiles && !hasBash && !hasBackground && !hasPwsh) return "";
	const lines = [
		hasBash ? "# Shell routing: bash → PowerShell 7" : hasFiles ? "# Repository file tools" : hasBackground ? "# Background task tools" : "# Windows-native shell",
		"",
		"| Task | Tool |",
		"| --- | --- |"
	];
	const row = (raw, task) => {
		if (names.has(publicToolName(raw))) lines.push(`| ${task} | ${publicToolName(raw)} |`);
	};
	row("inspect_local_file", "Text / multiple ranges / encoding / PDF text / hex");
	if (hasFiles && names.has("read_image")) lines.push("| Images | read_image (host) |");
	row("grep", "Search contents");
	row("glob", "Find paths");
	row("replace", "Batch replacement; use host edit for precise edits");
	row("bash", "General commands / builds / git / pipelines / scripts — preferred command executor");
	if (names.has("pwsh")) lines.push(`| Windows-native cmdlets / registry / services only | pwsh (${pwsh7 || levels?.pwsh ? "bundled PowerShell 7 via host" : "host PowerShell"}) |`);
	row("run", "Bounded bash command result (full access only)");
	if (names.has(publicToolName("run_background"))) lines.push(`| Background commands / owned jobs | ${BACKGROUND_TOOLS.map(publicToolName).filter((name) => names.has(name)).join(", ")} |`);
	lines.push("", "- ops_* arguments are strict: pass only declared fields.");
	if (hasFiles) lines.push("- Use file tools for file operations; use count for totals and batch independent requests.");
	if (hasFiles) lines.push("- Every file tool has one `path`, resolved relative to the current DSH session cwd. Use `/` separators; do not pass root, workspace, cwd, or file_path aliases.", "- Native file tools are UTF-8 first and bounded. glob and grep do not traverse symlinks, junctions, reparse points, hidden files, or `.git`.");
	if (hasFiles) lines.push("- On a tool error, correct the arguments and retry; do not switch to a shell workaround.");
	if (names.has(BASH_TOOL)) lines.push("- Prefer bash for command execution. Use PowerShell only when Windows-native functionality is necessary; fix bash errors in bash, do not switch shells or mix their syntax.", "- Use command only for short commands and pipelines. For scripts longer than about 1 KB or containing heredocs, quotes, backslashes or non-ASCII text, write the script to a file first and pass script_path.");
	if (names.has(publicToolName("run_background"))) lines.push("- Only operate on job IDs you started in this session.");
	if (extraGuidance.trim()) lines.push("", extraGuidance.trim());
	return lines.join("\n");
}
function hostShellRefusal({ toolName, denied }) {
	if (!denied.has(toolName)) return void 0;
	return {
		kind: "deny",
		reason: `Host tool ${toolName} is disabled by dsh-ops shellPolicy. Use an available file tool for file operations; otherwise request an operator policy change.`
	};
}
//#endregion
//#region src/ops/permissions.js
/** Shared DSH permission vocabulary. Model inputs never select an authority mode. */
const MODES = [
	"read-only",
	"workspace-write",
	"danger-full-access"
];
function permissionError(policy, operation, required = "workspace-write", message = "") {
	return {
		code: "POLICY_DENIED",
		phase: "preflight",
		retryable: false,
		effectState: "none",
		permission: {
			current: policy.mode,
			required,
			operation,
			workspaceRoot: policy.workspaceRoot
		},
		message: `User authorization does not permit ${operation} in DSH mode ${policy.mode}. ${message}`.trim(),
		nextAction: `Ask the user to change the DSH permission selector to ${required}. Do not retry, change directories, or bypass the sandbox.`
	};
}
function denied(policy, operation, required, message) {
	return {
		status: "rejected",
		error: permissionError(policy, operation, required, message),
		sandbox: { mode: policy.mode }
	};
}
//#endregion
//#region src/ops/ptc/runtime.js
/** Runtime discovery is installation-relative; explicit selections never silently fall back. */
const PLATFORMS = Object.freeze(Object.keys(optionalDependencies).map((name) => name.slice(12)));
function workerName(platform = process.platform) {
	return platform === "win32" ? "dsh-ops-worker.exe" : "dsh-ops-worker";
}
function resolveWorker(config = {}, { packageRoot = PACKAGE_ROOT, env = process.env, platform = process.platform, arch = process.arch } = {}) {
	if (!PLATFORMS.includes(`${platform}-${arch}`)) throw new Error(`Unsupported dsh-ops-lite runtime target ${platform}-${arch}.`);
	const explicit = config.binaryPath ?? env.DSH_OPS_WORKER_BIN;
	const candidates = explicit !== void 0 ? [explicit] : [path.join(runtimeRoot({
		packageRoot,
		platform,
		arch
	}), "runtime", `${platform}-${arch}`, workerName(platform))];
	for (const file of candidates) {
		if (!path.isAbsolute(file)) throw new Error("Native worker selection must be an absolute path.");
		let stat;
		try {
			stat = fs.statSync(file);
		} catch {
			continue;
		}
		if (!stat.isFile()) continue;
		if (file.includes(`${path.sep}runtime${path.sep}`)) {
			const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(file), "provenance.json"), "utf8"));
			const version$1 = version;
			if (receipt.target !== `${platform}-${arch}` || receipt.version !== version$1 || receipt.executable !== workerName(platform) || receipt.sha256 !== createHash("sha256").update(fs.readFileSync(file)).digest("hex")) throw new Error("Native worker provenance mismatch.");
		}
		return file;
	}
	throw new Error(`Native worker unavailable for ${platform}-${arch}. Install the matching platform artifact, or run pnpm build in the source checkout. No ACL repair, shell fallback or automatic download is performed.`);
}
//#endregion
//#region src/ops/workspace-preparation.js
/**
* Prepare the host's Windows ACL prerequisite before native or PTC execution.
* No monkey-patching host services; only the selected, owned workspace gains
* directory-only WRITE_OWNER. The DSH provider still owns confinement/grants.
*/
const script = fileURLToPath(new URL("./prepare-workspace.ps1", import.meta.url));
const pending = /* @__PURE__ */ new Map();
const prepared = /* @__PURE__ */ new Set();
function prepareWorkspace(policy, { platform = process.platform, run = runPreparation } = {}) {
	if (platform !== "win32" || policy?.mode !== "workspace-write") return Promise.resolve();
	if (!path.isAbsolute(policy.workspaceRoot ?? "")) return Promise.reject(/* @__PURE__ */ new Error("Invalid authoritative workspace root"));
	const root = fs.realpathSync.native(policy.workspaceRoot);
	if (path.normalize(root).toLowerCase() !== path.resolve(policy.workspaceRoot).toLowerCase()) return Promise.reject(/* @__PURE__ */ new Error("Workspace root must not resolve through a junction or symlink"));
	if (prepared.has(root)) return Promise.resolve();
	if (!pending.has(root)) {
		const work = Promise.resolve().then(() => run(root)).then(() => {
			prepared.add(root);
		}).finally(() => {
			pending.delete(root);
		});
		pending.set(root, work);
	}
	return pending.get(root);
}
function runPreparation(root) {
	const windows = process.env.SystemRoot ?? "C:\\Windows";
	const executable = path.join(windows, "System32/WindowsPowerShell/v1.0/powershell.exe");
	const home = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
	const backups = path.join(home, "dsh-ops/acl-backups");
	return new Promise((resolve, reject) => {
		const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"));
		const child = spawn(executable, [
			"-NoProfile",
			"-NonInteractive",
			"-File",
			script,
			"-Workspace",
			root,
			"-BackupDir",
			backups
		], {
			env,
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let stderr = "";
		child.stdout.resume();
		child.stderr.on("data", (b) => {
			stderr = (stderr + b.toString()).slice(-2048);
		});
		const timer = setTimeout(() => child.kill(), 1e4);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			code === 0 ? resolve() : reject(/* @__PURE__ */ new Error(`DSH workspace preparation failed (not a user permission denial): ${stderr.trim()}`));
		});
	});
}
function mountWorkspacePreparation(root) {
	if (process.platform !== "win32") return;
	root.inject(["sandboxPolicy", "tools"], (ctx) => {
		ctx.on("tools/execute", async (exec, next) => {
			const session = exec?.agent?.session;
			if (session && [
				"run_code",
				"pwsh",
				"bash",
				"pwsh_persistent",
				"bash_persistent"
			].includes(exec.name)) await prepareWorkspace(ctx.get("sandboxPolicy").resolve({ session }));
			return next();
		});
	});
}
//#endregion
export { PACKAGE_NAME as C, OFFICIAL_TOOL_SECTIONS as S, resolveBinary as _, denied as a, OFFICIAL_TOOLS as b, FILE_TOOLS as c, TOOLING_SECTION as d, hostShellRefusal as f, probeBinary as g, PACKAGE_ROOT as h, MODES as i, SECTION_ORDERS as l, renderToolingPolicy as m, prepareWorkspace as n, BACKGROUND_TOOLS as o, publicToolName as p, resolveWorker as r, BASH_TOOL as s, mountWorkspacePreparation as t, SHELL_TOOLS as u, runtimeRoot as v, OFFICIAL_TOOLS_DESCRIPTION as x, DEFAULT_CONFIG as y };

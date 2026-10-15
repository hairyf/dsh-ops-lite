import { _ as resolveBinary, a as denied, d as TOOLING_SECTION, f as hostShellRefusal, g as probeBinary, h as PACKAGE_ROOT, i as MODES, l as SECTION_ORDERS, m as renderToolingPolicy, n as prepareWorkspace, o as BACKGROUND_TOOLS, p as publicToolName, r as resolveWorker, s as BASH_TOOL, t as mountWorkspacePreparation, v as runtimeRoot } from "./workspace-preparation-Bi50pwsN.js";
import process from "node:process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import os, { tmpdir } from "node:os";
/**
* Per-call timeout for FastCtx tools, in milliseconds. FastCtx serves reads,
* searches, and replacements from a persistent process, so a call is normally
* fast; the ceiling is generous because `run` executes a real command and a
* build or test run legitimately takes minutes.
*/
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 3e5;
/** Upper bound accepted for `toolCallTimeoutMs`, matching the loader's timer ceiling. */
const MAX_TOOL_CALL_TIMEOUT_MS = 2147483647;
/** How the plugin treats the host's own shell tools. */
const SHELL_POLICIES = ["advise", "deny-host-shell"];
/** Host tool names the `deny-host-shell` policy refuses by default. */
const DEFAULT_DENIED_HOST_TOOLS = [
	"pwsh",
	"bash",
	"pwsh_persistent"
];
/** Error raised for a configuration value this plugin cannot honour. */
var ConfigError = class extends Error {
	/**
	* @param {string} message - what is wrong and what is accepted.
	*/
	constructor(message) {
		super(`dsh-ops config: ${message}`);
		this.name = "ConfigError";
	}
};
/**
* Reject a key the plugin does not implement instead of silently ignoring it.
* @param {Record<string, unknown>} raw - the whole row config.
* @param {string[]} known - accepted keys.
* @returns {void}
*/
function rejectUnknownKeys(raw, known) {
	const unknown = Object.keys(raw).filter((key) => !known.includes(key));
	if (unknown.length > 0) throw new ConfigError(`unknown key(s) ${unknown.map((key) => JSON.stringify(key)).join(", ")}; accepted keys are ${known.map((key) => JSON.stringify(key)).join(", ")}`);
}
/**
* Read an optional string.
* @param {Record<string, unknown>} raw - the whole row config.
* @param {string} key - the key to read.
* @returns {string|undefined} the value, or undefined when absent.
*/
function optionalString(raw, key) {
	const value = raw[key];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string" || value.trim() === "") throw new ConfigError(`${key} must be a non-empty string, got ${JSON.stringify(value)}`);
	return value;
}
/**
* Read an optional boolean.
* @param {Record<string, unknown>} raw - the whole row config.
* @param {string} key - the key to read.
* @param {boolean} fallback - the value when the key is absent.
* @returns {boolean} the value.
*/
function optionalBoolean(raw, key, fallback) {
	const value = raw[key];
	if (value === void 0 || value === null) return fallback;
	if (typeof value !== "boolean") throw new ConfigError(`${key} must be a boolean, got ${JSON.stringify(value)}`);
	return value;
}
/**
* Read an optional list of non-empty strings.
* @param {Record<string, unknown>} raw - the whole row config.
* @param {string} key - the key to read.
* @param {string[]} fallback - the value when the key is absent.
* @returns {string[]} the value.
*/
function optionalStringList(raw, key, fallback) {
	const value = raw[key];
	if (value === void 0 || value === null) return fallback;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) throw new ConfigError(`${key} must be an array of non-empty strings, got ${JSON.stringify(value)}`);
	return [...value];
}
/**
* The resolved configuration, with every default applied.
* @typedef {object} ResolvedConfig
* @property {number} configUpdateVersion - per-row completed configuration migration version.
* @property {string|undefined} binaryPath - explicit FastCtx executable.
* @property {string} serverName - tool namespace owner.
* @property {boolean} enableShellTools - opt into run/job tools, additionally gated by session authority.
* @property {number} toolCallTimeoutMs - per-call deadline for one FastCtx tool call.
* @property {boolean} required - fail activation when the server cannot start.
* @property {'advise'|'deny-host-shell'} shellPolicy - treatment of host shell tools.
* @property {string[]} deniedHostTools - tool names refused by `deny-host-shell`.
* @property {boolean} promptPolicy - inject the repository-tooling prompt section.
* @property {string} extraGuidance - extra text appended to that section.
* @property {string|undefined} bashPath - explicit executable for the plugin's bash layer.
* @property {boolean} publishBashTool - publish ops_bash in full-access sessions with a usable bash and subprocess service.
* @property {boolean} allowSystemShellFallback - let the bash rung use a
*   system-installed bash when the plugin carries no copy of its own.
*/
/**
* Validate one plugin row's config.
* @param {unknown} rawConfig - the `config` value from the loader row.
* @returns {ResolvedConfig} the resolved configuration.
*/
function resolveConfig(rawConfig) {
	rawConfig ??= {};
	if (typeof rawConfig !== "object" || Array.isArray(rawConfig)) throw new ConfigError(`config must be an object, got ${JSON.stringify(rawConfig)}`);
	const raw = rawConfig;
	rejectUnknownKeys(raw, [
		"binaryPath",
		"serverName",
		"enableShellTools",
		"toolCallTimeoutMs",
		"required",
		"shellPolicy",
		"deniedHostTools",
		"promptPolicy",
		"extraGuidance",
		"bashPath",
		"publishBashTool",
		"allowSystemShellFallback",
		"configUpdateVersion"
	]);
	const configUpdateVersion = raw.configUpdateVersion ?? 0;
	if (!Number.isSafeInteger(configUpdateVersion) || configUpdateVersion < 0) throw new ConfigError("configUpdateVersion must be a non-negative safe integer");
	const serverName = optionalString(raw, "serverName") ?? "fastctx";
	if (!/^[\w-]{1,32}$/.test(serverName)) throw new ConfigError(`serverName must match [A-Za-z0-9_-]{1,32}, got ${JSON.stringify(serverName)}`);
	const timeout = raw.toolCallTimeoutMs;
	if (timeout !== void 0 && timeout !== null && (!Number.isFinite(timeout) || Number(timeout) <= 0 || Number(timeout) > MAX_TOOL_CALL_TIMEOUT_MS)) throw new ConfigError(`toolCallTimeoutMs must be a positive finite number of milliseconds, got ${JSON.stringify(timeout)}`);
	const shellPolicy = optionalString(raw, "shellPolicy") ?? "advise";
	if (!SHELL_POLICIES.includes(shellPolicy)) throw new ConfigError(`shellPolicy must be one of ${SHELL_POLICIES.map((value) => JSON.stringify(value)).join(", ")}, got ${JSON.stringify(shellPolicy)}`);
	return {
		configUpdateVersion,
		binaryPath: optionalString(raw, "binaryPath"),
		serverName,
		enableShellTools: optionalBoolean(raw, "enableShellTools", true),
		toolCallTimeoutMs: timeout === void 0 || timeout === null ? DEFAULT_TOOL_CALL_TIMEOUT_MS : Number(timeout),
		required: optionalBoolean(raw, "required", false),
		shellPolicy,
		deniedHostTools: optionalStringList(raw, "deniedHostTools", DEFAULT_DENIED_HOST_TOOLS),
		promptPolicy: optionalBoolean(raw, "promptPolicy", true),
		extraGuidance: optionalString(raw, "extraGuidance") ?? "",
		bashPath: optionalString(raw, "bashPath"),
		publishBashTool: optionalBoolean(raw, "publishBashTool", true),
		allowSystemShellFallback: optionalBoolean(raw, "allowSystemShellFallback", false)
	};
}
//#endregion
//#region src/ops/file/contract.js
const string = { type: "string" };
const integer = {
	type: "integer",
	minimum: 0
};
const bounded = (properties, required = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false
});
const FILE_TOOLS = Object.freeze([
	"inspect_local_file",
	"grep",
	"glob",
	"replace"
]);
const PARAMETERS = Object.freeze({
	inspect_local_file: bounded({
		path: string,
		offset: {
			...integer,
			minimum: 1
		},
		limit: {
			...integer,
			minimum: 1,
			maximum: 1e4
		},
		encoding: {
			type: "string",
			enum: ["utf-8"]
		},
		view: {
			type: "string",
			enum: ["text", "hex"]
		}
	}),
	glob: bounded({
		path: string,
		pattern: {
			type: "array",
			minItems: 1,
			items: string
		},
		outputMode: {
			type: "string",
			enum: ["paths", "details"]
		},
		sort: {
			type: "string",
			enum: ["path", "modified"]
		},
		offset: integer,
		limit: {
			...integer,
			minimum: 1,
			maximum: 1e4
		}
	}, ["pattern"]),
	grep: bounded({
		path: string,
		pattern: string,
		glob: {
			type: "array",
			items: string
		},
		outputMode: {
			type: "string",
			enum: [
				"files_with_matches",
				"content",
				"count",
				"summary"
			]
		},
		caseInsensitive: { type: "boolean" },
		lineNumbers: { type: "boolean" },
		beforeContext: {
			...integer,
			maximum: 32
		},
		afterContext: {
			...integer,
			maximum: 32
		},
		multiline: { type: "boolean" },
		offset: integer,
		limit: {
			...integer,
			minimum: 1,
			maximum: 1e4
		}
	}, ["pattern"]),
	replace: bounded({
		path: string,
		pattern: string,
		replacement: string,
		glob: {
			type: "array",
			items: string
		},
		maxReplacements: {
			...integer,
			minimum: 1,
			maximum: 1e5
		},
		dryRun: { type: "boolean" }
	}, ["pattern", "replacement"])
});
const OUTPUT = {
	type: "object",
	properties: {
		status: { type: "string" },
		phase: { type: "string" },
		changed: { type: "integer" },
		matched: { type: "integer" },
		skipped: { type: "integer" },
		failed: { type: "integer" },
		complete: { type: "boolean" },
		omitted: { type: "integer" },
		total: { type: "integer" },
		nextOffset: { type: "integer" },
		truncated: { type: "boolean" },
		items: {
			type: "array",
			items: {}
		},
		dryRun: { type: "boolean" },
		files: { type: "integer" },
		matches: { type: "integer" },
		error: { type: "object" }
	}
};
const DESCRIPTIONS = Object.freeze({
	inspect_local_file: "Read bounded UTF-8 text lines or a hex view from path relative to the DSH session cwd. Directories are rejected; use ops_glob or ops_grep.",
	glob: "Find regular files below path using explicit include/exclude glob patterns. Symlinks, reparse points, hidden files and .git are not traversed.",
	grep: "Search UTF-8 files below path with Rust regex, bounded output, paging and optional line context.",
	replace: "Perform a deterministic UTF-8 replacement under path. dryRun observes only; writes use revision checks and atomic replacement. Read-only sessions are rejected."
});
function definition(rawName, execute) {
	return {
		name: publicToolName(rawName),
		description: DESCRIPTIONS[rawName],
		parameters: PARAMETERS[rawName],
		...rawName !== "replace" ? { isConcurrencySafe: () => true } : {},
		output: {
			schema: OUTPUT,
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		execute
	};
}
//#endregion
//#region src/ops/file/worker.js
/** Native file worker bridge. The host owns path resolution and DSH authority. */
function failure(code, message, phase = "preflight", effectState = "none") {
	return {
		status: code === "POLICY_DENIED" ? "rejected" : "error",
		phase,
		changed: 0,
		matched: 0,
		skipped: 0,
		failed: 0,
		complete: false,
		omitted: 0,
		error: {
			code,
			phase,
			retryable: false,
			effectState,
			nextAction: effectState === "none" ? "Correct the request or restore host authority." : "Inspect the result; do not blindly retry after an unknown effect.",
			message
		}
	};
}
function absoluteTarget(raw, cwd) {
	if (typeof raw !== "string" || raw.length === 0 || raw.includes("\0")) return void 0;
	return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw);
}
function inside(root, target) {
	const base = path.resolve(root);
	const candidate = path.resolve(target);
	const relative = path.relative(base, candidate);
	return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function invoke(ctx, file, tool, args, exec, signal) {
	const session = exec?.agent?.session;
	let cwd = session?.header?.cwd;
	if (!session?.id || typeof cwd !== "string" || !path.isAbsolute(cwd)) return failure("POLICY_DENIED", "An authoritative session identity and cwd are required.");
	try {
		cwd = fs.realpathSync.native(cwd);
	} catch (error) {
		return failure("POLICY_DENIED", `The authoritative session cwd is unavailable. ${String(error?.message ?? error)}`);
	}
	const policyService = ctx.get("sandboxPolicy");
	const subprocess = ctx.get("subprocess");
	if (!policyService?.resolve || !subprocess?.spawn) return failure("EXECUTOR_UNAVAILABLE", "DSH policy and subprocess services are required.");
	let policy;
	try {
		policy = policyService.resolve({ session });
	} catch (error) {
		return failure("POLICY_DENIED", String(error?.message ?? error));
	}
	if (![
		"read-only",
		"workspace-write",
		"danger-full-access"
	].includes(policy?.mode) || typeof policy.workspaceRoot !== "string" || !path.isAbsolute(policy.workspaceRoot)) return failure("POLICY_DENIED", "Invalid authoritative DSH policy.");
	if (tool === "replace" && policy.mode === "read-only") return denied(policy, "replace", "workspace-write", "The user selected read-only; no files were changed.");
	const operationPath = absoluteTarget(args?.path ?? ".", cwd);
	if (!operationPath) return failure("INVALID_ARGUMENT", "path must be a non-empty path.");
	const canonical = (value) => {
		try {
			return fs.realpathSync.native(value);
		} catch {
			return value;
		}
	};
	const writeRoots = [
		policy.workspaceRoot,
		tmpdir(),
		...process.platform === "win32" ? [] : ["/tmp"]
	].map(canonical);
	if (tool === "replace" && policy.mode === "workspace-write" && !writeRoots.some((root) => inside(root, canonical(operationPath)))) return denied(policy, "replace outside the workspace or DSH temporary areas", "danger-full-access", "The user authorized workspace writes only; no files were changed.");
	const workerArgs = {
		...args,
		path: operationPath
	};
	const input = JSON.stringify({
		root: cwd,
		scope: String(session.id),
		tool,
		args: workerArgs,
		read_only: policy.mode === "read-only",
		...policy.mode === "workspace-write" ? { write_roots: writeRoots } : {}
	});
	if (Buffer.byteLength(input) > 2 * 1024 * 1024) return failure("OUTPUT_LIMIT", "Request exceeds the 2 MiB byte budget.");
	let spawned = false;
	try {
		const argv = [file];
		signal?.throwIfAborted?.();
		const current = policyService.resolve({ session });
		if (current.mode !== policy.mode || current.workspaceRoot !== policy.workspaceRoot) return failure("POLICY_DENIED", "Authority changed during preparation.");
		const handle = subprocess.spawn({
			argv,
			cwd,
			stdio: {
				stdin: { data: input },
				stdout: { maxBytes: 128 * 1024 },
				stderr: { maxBytes: 16 * 1024 }
			},
			graceMs: 1e3,
			signal
		});
		spawned = true;
		const outcome = await handle.done;
		const stdout = handle.collected.stdout.readFrom(0);
		const stderr = handle.collected.stderr.readFrom(0);
		if (signal?.aborted || outcome.signal) return failure("RESULT_UNKNOWN", "Worker interrupted; inspect postconditions.", "execute", "unknown");
		if (stdout.lossy) return failure("OUTPUT_LIMIT", "Worker output exceeded the byte budget; operation facts may have changed.", "verify", "unknown");
		if (outcome.exitCode !== 0) return failure("RESULT_UNKNOWN", `Worker did not return a settled result: ${stderr.text.slice(0, 500)}`, "execute", "unknown");
		let value;
		try {
			value = JSON.parse(stdout.text);
		} catch {
			return failure("RESULT_UNKNOWN", "Worker returned invalid JSON; inspect postconditions.", "verify", "unknown");
		}
		return {
			...value,
			sandbox: {
				mode: policy.mode,
				enforcement: "policy",
				boundary: "trusted-native-file-operations"
			}
		};
	} catch (error) {
		return failure(spawned ? "RESULT_UNKNOWN" : "EXECUTOR_UNAVAILABLE", `DSH trusted file executor failed; this is not a user authorization denial. ${String(error?.message ?? error)}`, "execute", spawned ? "unknown" : "none");
	}
}
//#endregion
//#region src/ops/file/runtime.js
var NativeFileTools = class {
	constructor({ ctx, config, report }) {
		this.ctx = ctx;
		this.config = config;
		this.report = report ?? (() => {});
		this.file = void 0;
		this.active = /* @__PURE__ */ new Map();
		this.disposers = [];
		this.stopped = false;
	}
	async start() {
		this.file = this.config.workerPath;
		if (!this.file) {
			if (this.config.required) throw new Error("Native file worker path is unavailable.");
			return [];
		}
		for (const rawName of FILE_TOOLS) this.disposers.push(this.ctx.tools.register(definition(rawName, (args, exec) => this.call(rawName, args, exec))));
		return FILE_TOOLS.map((name) => `ops_${name}`);
	}
	async call(tool, args, exec) {
		if (this.stopped) return failure("POLICY_DENIED", "Native file component is disposed.");
		const controller = new AbortController();
		const abort = () => controller.abort(exec?.signal?.reason);
		if (exec?.signal?.aborted) abort();
		else exec?.signal?.addEventListener?.("abort", abort, { once: true });
		let finish;
		this.active.set(controller, new Promise((resolve) => {
			finish = resolve;
		}));
		try {
			return await invoke(this.ctx, this.file, tool, args, exec, controller.signal);
		} finally {
			this.active.delete(controller);
			finish();
			exec?.signal?.removeEventListener?.("abort", abort);
		}
	}
	async stop() {
		this.stopped = true;
		for (const controller of this.active.keys()) controller.abort(/* @__PURE__ */ new Error("Native file component unloaded"));
		await Promise.allSettled(this.active.values());
		for (const dispose of this.disposers.splice(0)) dispose();
	}
};
//#endregion
//#region src/ops/session-pwsh.js
/** A reversible runtime-only config overlay; never edits profile files or services. */
function mountBundledPwsh(ctx, shells) {
	if (!shells.pwsh.available || process.platform !== "win32") return;
	ctx.inject(["loader"], (loaderCtx) => {
		const loader = loaderCtx.get("loader");
		const matches = (entry) => entry?.options?.id === "pwsh-sandbox" && entry.options.name === "@deepseek-ai/dsh-pwsh-sandbox";
		const refresh = () => {
			for (const entry of loader.entries()) if (matches(entry) && entry.fiber?.state === 2) entry.fiber.update(entry.options.config, true);
		};
		const unhook = loaderCtx.on("internal/config", function(_raw, next) {
			const config = next();
			if (!matches(this.entry) || this.parent?.fiber?.entry === this.entry) return config;
			return {
				...config,
				pwshPath: shells.pwsh.file
			};
		}, {
			global: true,
			prepend: true
		});
		let stopped = false;
		loaderCtx.effect(() => () => {
			if (stopped) return;
			stopped = true;
			unhook();
			refresh();
		}, "dsh-ops: restore owning PowerShell executor config");
		refresh();
	});
}
//#endregion
//#region src/ops/bash-pe.js
/** Strict PE import redirection, never patch executable instructions or original package bytes. */
function patchMsys(bytes) {
	const b = Buffer.from(bytes);
	if (b.toString("ascii", 0, 2) !== "MZ") throw new Error("Expected PE");
	const pe = b.readUInt32LE(60);
	const optional = pe + 24;
	if (b.readUInt32LE(pe) !== 17744 || b.readUInt16LE(pe + 4) !== 34404 || b.readUInt16LE(optional) !== 523) throw new Error("Expected x64 PE32+");
	const section = optional + b.readUInt16LE(pe + 20);
	const sections = [];
	for (let i = 0; i < b.readUInt16LE(pe + 6); i++) {
		const at = section + 40 * i;
		sections.push({
			rva: b.readUInt32LE(at + 12),
			size: Math.max(b.readUInt32LE(at + 8), b.readUInt32LE(at + 16)),
			raw: b.readUInt32LE(at + 20)
		});
	}
	const off = (r) => {
		const s = sections.find((s) => r >= s.rva && r < s.rva + s.size);
		if (!s) throw new Error("PE RVA outside sections");
		return r - s.rva + s.raw;
	};
	const string = (r) => {
		const at = off(r);
		const end = b.indexOf(0, at);
		if (end < 0 || end - at > 256) throw new Error("Invalid PE import name");
		return b.toString("ascii", at, end);
	};
	const exports = {};
	let table = off(b.readUInt32LE(optional + 120));
	for (let count = 0; b.readUInt32LE(table + 12); count++, table += 20) {
		if (count > 64) throw new Error("PE import limit");
		const name = string(b.readUInt32LE(table + 12)).toLowerCase();
		if (!["kernel32.dll", "ntdll.dll"].includes(name)) continue;
		const names = [];
		let thunk = off(b.readUInt32LE(table) || b.readUInt32LE(table + 16));
		for (let n = 0; b.readBigUInt64LE(thunk); n++, thunk += 8) {
			if (n > 1024) throw new Error("PE thunk limit");
			const value = b.readBigUInt64LE(thunk);
			if (value >= 9223372036854775808n) throw new Error("Ordinal imports unsupported");
			names.push(string(Number(value) + 2));
		}
		exports[name] = names;
		const at = off(b.readUInt32LE(table + 12));
		b.fill(0, at, at + name.length);
		b.write(name === "kernel32.dll" ? "opsipc.dll" : "opsnt.dll", at, "ascii");
	}
	if (!exports["kernel32.dll"]?.includes("CreateNamedPipeA") || !exports["ntdll.dll"]?.includes("NtCreateNamedPipeFile")) throw new Error("Unexpected MSYS imports");
	return {
		bytes: b,
		exports
	};
}
//#endregion
//#region src/ops/bash-ipc.js
/**
* Installation-relative, verified private MSYS runtime for confined Windows calls.
* Original payloads remain untouched. Full access does not select this runtime.
*/
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cache = /* @__PURE__ */ new Map();
function confinedBash(file, { home = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), platform = process.platform } = {}) {
	if (platform !== "win32") return { file };
	const directory = path.dirname(file);
	const root = path.basename(directory).toLowerCase() === "bin" && path.basename(path.dirname(directory)).toLowerCase() === "usr" ? path.resolve(directory, "../..") : path.resolve(directory, "..");
	const dll = path.join(root, "usr/bin/msys-2.0.dll");
	if (!fs.existsSync(dll)) throw new Error("EXECUTOR_UNAVAILABLE: Windows confined Bash requires the supported MSYS payload layout; no unconfined fallback.");
	const bytes = fs.readFileSync(dll);
	const proxies = path.join(runtimeRoot(), "runtime/win32-x64/bash-ipc");
	const receipt = JSON.parse(fs.readFileSync(path.join(proxies, "provenance.json"), "utf8"));
	if (receipt.platform !== "win32-x64" || receipt.msysSha256 !== hash(bytes)) throw new Error("EXECUTOR_UNAVAILABLE: This MSYS version has no verified DSH IPC compatibility build. Rebuild the matching proxies; do not bypass confinement.");
	const proxyBytes = {};
	for (const name of ["opsipc.dll", "opsnt.dll"]) {
		proxyBytes[name] = fs.readFileSync(path.join(proxies, name));
		if (hash(proxyBytes[name]) !== receipt.files[name]) throw new Error(`Bash IPC provenance mismatch: ${name}`);
	}
	const identity = hash(Buffer.from(JSON.stringify({
		root,
		msys: receipt.msysSha256,
		files: receipt.files
	}))).slice(0, 24);
	const target = path.join(home, "dsh-ops/bash-ipc", identity);
	const selected = path.join(target, "usr/bin/bash.exe");
	const key = path.resolve(target);
	if (cache.has(key)) {
		const value = cache.get(key);
		if (hash(fs.readFileSync(path.join(target, "usr/bin/msys-2.0.dll"))) !== hash(patchMsys(bytes).bytes) || !["opsipc.dll", "opsnt.dll"].every((name) => hash(fs.readFileSync(path.join(target, "usr/bin", name))) === receipt.files[name])) throw new Error("Bash IPC cached runtime integrity mismatch; refusing execution.");
		return value;
	}
	const patched = patchMsys(bytes).bytes;
	const marker = path.join(target, ".ops-ipc.json");
	let valid = false;
	try {
		valid = JSON.parse(fs.readFileSync(marker, "utf8")).identity === identity && fs.existsSync(selected) && hash(fs.readFileSync(path.join(target, "usr/bin/msys-2.0.dll"))) === hash(patched) && ["opsipc.dll", "opsnt.dll"].every((name) => hash(fs.readFileSync(path.join(target, "usr/bin", name))) === receipt.files[name]);
	} catch {}
	if (!valid) {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const stage = fs.mkdtempSync(path.join(path.dirname(target), "stage-"));
		try {
			fs.cpSync(root, stage, {
				recursive: true,
				filter: (source) => ![".git", "node_modules"].includes(path.basename(source))
			});
			fs.writeFileSync(path.join(stage, "usr/bin/msys-2.0.dll"), patched);
			for (const [name, data] of Object.entries(proxyBytes)) fs.writeFileSync(path.join(stage, "usr/bin", name), data);
			fs.writeFileSync(path.join(stage, ".ops-ipc.json"), `${JSON.stringify({
				identity,
				source: root,
				msys: receipt.msysSha256,
				patchedSha256: hash(patched),
				files: receipt.files
			})}\n`);
			if (fs.existsSync(target)) throw new Error("Bash IPC runtime integrity mismatch; refusing to overwrite an existing generation.");
			try {
				fs.renameSync(stage, target);
			} catch (error) {
				if (!fs.existsSync(marker)) throw error;
			}
		} finally {
			fs.rmSync(stage, {
				recursive: true,
				force: true
			});
		}
	}
	const result = {
		file: selected,
		env: { PATH: [
			path.join(target, "usr/bin"),
			path.join(target, "ucrt64/bin"),
			path.join(target, "cmd"),
			process.env.PATH ?? ""
		].join(path.delimiter) },
		runtime: identity
	};
	cache.set(key, result);
	return result;
}
//#endregion
//#region src/ops/shells.js
/**
* Resolve shells without writing PATH, profiles or the working directory.
* Windows shells come from the exact npm runtime package; Unix uses system Bash.
* Configured Bash paths remain authoritative. Missing runtime packages fail closed;
* there is no provisioner, download or compilation fallback.
*/
/** The directory this module was loaded from; the resolution root of a checkout. */
const MODULE_ROOT = PACKAGE_ROOT;
/** Model-facing name of the tool this module publishes for the bash rung. */
const BASH_TOOL_NAME = publicToolName("bash");
/** Default foreground deadline for one `ops_bash` command, in milliseconds. */
const DEFAULT_BASH_TIMEOUT_MS = 12e4;
/** Upper bound for a per-call `timeoutMs`, in milliseconds. */
const MAX_BASH_TIMEOUT_MS = 2147483647;
/**
* Grace period handed to `ctx.subprocess` for its SIGTERM→SIGKILL escalation,
* matching the upstream bash executor's default
* (`packages/shell/bash-local/src/index.ts:35`).
*/
const DEFAULT_GRACE_MS = 3e3;
/** Per-stream in-memory cap, matching the upstream executor default. */
const DEFAULT_MAX_OUTPUT_BYTES = 64e3;
/** Per-stream spill-file cap; a larger stream keeps only its in-memory tail. */
const DEFAULT_MAX_SPILL_BYTES = 64 * 1024 * 1024;
/**
* Every argument `ops_bash` declares, in schema order.
*
* `execute` enforces this list while `parameters.properties` documents it, and
* the two are written separately, so they can drift: a name added to the schema
* but not here would be refused as unknown, and a name kept here after the
* schema drops it would silently pass through. `test/shells.test.mjs` pins the
* two against each other.
*/
const BASH_ARGUMENTS = Object.freeze([
	"command",
	"description",
	"script_path",
	"workdir",
	"timeoutMs",
	"graceMs"
]);
/**
* Model-friendly environment overrides: disable colors, pagers, and interactive
* terminal features that would garble tool output. This is the upstream bash
* executor's set verbatim (`packages/shell/bash-local/src/index.ts:27-32`),
* passed as an explicit `env`, which the subprocess service merges AFTER its
* ambient credential scrub.
*/
const ENV_OVERRIDES = Object.freeze({
	NO_COLOR: "1",
	TERM: "dumb",
	PAGER: "cat",
	GIT_PAGER: "cat"
});
/** Windows vendor layouts within the exact npm runtime package. */
const SHELL_LAYOUTS = Object.freeze({
	bash: {
		executable: "bash.exe",
		vendor: "bash"
	},
	pwsh: {
		executable: "pwsh.exe",
		vendor: "pwsh"
	}
});
Object.freeze([Object.freeze({
	name: "bash",
	label: "Git for Windows PortableGit",
	platform: "win32",
	arch: "x64",
	upstreamRepo: "https://github.com/git-for-windows/git",
	releaseTag: "v2.56.0.windows.2",
	version: "2.56.0.2",
	assetFile: "PortableGit-2.56.0.2-64-bit.7z.exe",
	url: "https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/PortableGit-2.56.0.2-64-bit.7z.exe",
	sha256: "075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b",
	bytes: 60027568,
	license: "GPL-2.0-only",
	extractor: "sfx-7z",
	extractTo: ".",
	executableRelativePath: "bin/bash.exe",
	executableSha256: "6cc575e9112efe6253b6a6999c12aa0240cb3f511aeda3480ae026edc0dc5280"
}), Object.freeze({
	name: "pwsh",
	label: "PowerShell",
	platform: "win32",
	arch: "x64",
	upstreamRepo: "https://github.com/PowerShell/PowerShell",
	releaseTag: "v7.6.6",
	version: "7.6.6",
	assetFile: "PowerShell-7.6.6-win-x64.zip",
	url: "https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6-win-x64.zip",
	sha256: "02fe458be20493fbdf43f61ea20610b811ee6c738ab1676c61b9cfcd1a33c860",
	bytes: 106328873,
	license: "MIT",
	extractor: "zip",
	extractTo: "bin",
	executableRelativePath: "bin/pwsh.exe",
	executableSha256: "bfb46af89433268872ddb43d1ca7a3f433452ee91ed356a9786940f90118e285"
})]);
/**
* One shell rung's resolution.
* @typedef {object} ShellResolution
* @property {boolean} available - whether this rung can run right now.
* @property {string|undefined} file - the resolved executable, when available.
* @property {string} source - where the answer came from, for reports and tests.
*   One of `disabled`, `config`, `bundled`, `path`, `well-known`,
*   `missing`.
* @property {string} detail - a one-line English explanation, for reports.
*/
/**
* Whether a candidate names something this process can spawn.
*
* `lstat` is used deliberately: a symlink (the Node shape of a Windows Store
* app-execution alias) is a valid executable even when its target is not
* statable, a real directory never is, and any unexpected error answers `false`
* rather than throwing out of a load-time probe.
* @param {string|undefined} file - the candidate path.
* @returns {boolean} whether the candidate exists and is not a directory.
*/
function isSpawnableFile(file) {
	if (typeof file !== "string" || file === "") return false;
	try {
		const stat = fs.lstatSync(file);
		return stat.isFile() || stat.isSymbolicLink();
	} catch {
		return false;
	}
}
/**
* The `<platform>-<arch>` infix both the platform packages and the vendored
* layout use (`win32-x64`).
* @param {string} platform - `process.platform`.
* @param {string} arch - `process.arch`.
* @returns {string} the key.
*/
function platformKey(platform, arch) {
	return `${platform}-${arch}`;
}
/**
* The vendored bundled shell inside the package, whether or not it exists.
* @param {object} options - resolution inputs.
* @param {'bash'|'pwsh'} options.kind - which rung.
* @param {string} options.bundleRoot - the plugin package root.
* @param {string} options.platform - `process.platform`.
* @param {string} options.arch - `process.arch`.
* @returns {string} the path the bundled copy would occupy.
*/
function bundledShellPath({ kind, bundleRoot, platform, arch }) {
	const target = SHELL_LAYOUTS[kind];
	const root = platform === "win32" ? runtimeRoot({
		packageRoot: bundleRoot,
		platform,
		arch
	}) : bundleRoot;
	return path.join(root, "vendor", target.vendor, platformKey(platform, arch), ...kind === "bash" && platform === "win32" ? ["bin"] : [], target.executable);
}
/** @typedef {'incomplete-tree'} BundledCause */
/**
* The plugin's own copy of one shell, from whichever layout carries it: the
* installed platform package first, then the vendored subdirectory.
*
* `cause` is carried alongside `detail` so a caller that has to act on the
* miss — {@link resolveBash} chooses which remedy to print — reads a fact
* instead of parsing the sentence. It is additive: callers that only read
* `file`/`detail` are unaffected.
* @param {object} options - resolution inputs.
* @param {'bash'|'pwsh'} options.kind - which rung.
* @param {string} options.bundleRoot - the plugin package root.
* @param {string} options.platform - `process.platform`.
* @param {string} options.arch - `process.arch`.
* @returns {{file: string|undefined, detail: string|undefined, cause: BundledCause|undefined}}
*   the executable and, when there is none, why the plugin's own copy is
*   unusable — as text for a report, and as the cause behind it.
*/
function bundledShell({ kind, bundleRoot, platform, arch }) {
	const file = bundledShellPath({
		kind,
		bundleRoot,
		platform,
		arch
	});
	return isSpawnableFile(file) ? {
		file,
		detail: void 0,
		cause: void 0
	} : {
		file: void 0,
		detail: `Runtime package does not contain ${kind}: ${file}`,
		cause: "incomplete-tree"
	};
}
/**
* One executable found by walking a PATH-shaped string.
*
* This is a read-only walk of the value it was handed: it never writes PATH and
* never consults anything but the string it is given.
* @param {object} options - search inputs.
* @param {string[]} options.names - executable names to accept, in order.
* @param {string|undefined} options.pathValue - the PATH value to walk.
* @param {(file: string) => boolean} [options.reject] - reject a discovered candidate.
* @returns {string|undefined} the first existing entry, or undefined.
*/
function fromPath({ names, pathValue, reject }) {
	if (typeof pathValue !== "string" || pathValue.trim() === "") return void 0;
	for (const entry of pathValue.split(path.delimiter)) {
		const directory = entry.trim().replace(/^"(.*)"$/, "$1");
		if (directory === "" || !path.isAbsolute(directory)) continue;
		for (const name of names) {
			const file = path.join(directory, name);
			if (isSpawnableFile(file) && !(reject?.(file) ?? false)) return file;
		}
	}
}
/**
* Windows ships `%SystemRoot%\\System32\\bash.exe` as the WSL distribution
* launcher, not as a POSIX shell. Treating it as a normal PATH bash silently
* moves commands into a Linux distribution, so it must never be selected by
* the system fallback. `path.win32` is intentional: tests can exercise the
* Windows resolver while running on another host platform.
* @param {string} file - candidate executable.
* @param {NodeJS.ProcessEnv} env - environment containing SystemRoot.
* @param {string} platform - target platform.
* @returns {boolean} whether the candidate is the WSL launcher.
*/
function isWslBashLauncher(file, env, platform) {
	if (platform !== "win32") return false;
	const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
	if (typeof systemRoot !== "string" || systemRoot.trim() === "") return false;
	const normalize = (value) => path.win32.normalize(value).replace(/[\\/]+$/, "").toLowerCase();
	return normalize(file) === normalize(path.win32.join(systemRoot, "System32", "bash.exe"));
}
/**
* The well-known install locations to probe for one rung.
*
* The bash list deliberately omits `%SystemRoot%\System32\bash.exe`: that is the
* WSL distribution launcher, not a POSIX shell over the caller's filesystem, so
* spawning it would silently run the command on a different machine. The pwsh
* list keeps Windows PowerShell 5.1 last, matching upstream's own resolution
* order (`packages/shell/pwsh-local/src/resolve.ts:21-37`).
* @param {object} options - probe inputs.
* @param {'bash'|'pwsh'} options.kind - which rung.
* @param {NodeJS.ProcessEnv} options.env - the environment to read.
* @param {string} options.platform - `process.platform`.
* @returns {string[]} the candidate paths, in order.
*/
function wellKnownCandidates({ kind, env, platform }) {
	if (platform !== "win32") return [];
	const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? "C:\\Program Files";
	const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
	const localAppData = env.LOCALAPPDATA ?? env.LocalAppData ?? "";
	const userProfile = env.USERPROFILE ?? "";
	return (kind === "bash" ? [
		path.join(programFiles, "Git", "bin", "bash.exe"),
		path.join(programFiles, "Git", "usr", "bin", "bash.exe"),
		path.join(programFilesX86, "Git", "bin", "bash.exe"),
		localAppData === "" ? "" : path.join(localAppData, "Programs", "Git", "bin", "bash.exe"),
		userProfile === "" ? "" : path.join(userProfile, "scoop", "shims", "bash.exe"),
		userProfile === "" ? "" : path.join(userProfile, "scoop", "apps", "git", "current", "bin", "bash.exe"),
		"C:\\ProgramData\\chocolatey\\bin\\bash.exe",
		"C:\\tools\\msys64\\usr\\bin\\bash.exe",
		"C:\\msys64\\usr\\bin\\bash.exe"
	] : [
		path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
		path.join(programFiles, "PowerShell", "7-preview", "pwsh.exe"),
		path.join(programFilesX86, "PowerShell", "7", "pwsh.exe"),
		localAppData === "" ? "" : path.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe"),
		userProfile === "" ? "" : path.join(userProfile, "scoop", "shims", "pwsh.exe"),
		"C:\\ProgramData\\chocolatey\\bin\\pwsh.exe"
	]).filter((file) => file !== "");
}
/**
* The executable names one rung answers to.
* @param {'bash'|'pwsh'} kind - which rung.
* @param {string} platform - `process.platform`.
* @returns {string[]} the names, in probe order.
*/
function executableNames(kind, platform) {
	const base = kind === "bash" ? "bash" : "pwsh";
	return platform === "win32" ? [`${base}.exe`, base] : [base];
}
/**
* The remedy for a bash this deployment cannot place at all: the one action
* that is right whatever the cause was, and therefore the one both the load
* time detail and the spawn time failure fall back to. It is written once
* because it is one decision — the spawn wording only adds the sentence's
* closing period.
*/
const GENERIC_BASH_REMEDY = "reinstall dsh-ops-lite with optional dependencies enabled; no download or compilation fallback is used";
/**
* Resolve the bash rung: explicit config, the npm runtime package, then — only
* while the deployment allows a system shell — PATH and the
* well-known install locations.
*
* A configured path is authoritative: when it is unusable the rung reports
* `available: false` instead of quietly running a different shell.
* @param {object} options - resolution inputs.
* @param {string|undefined} options.configured - the configured executable.
* @param {string|undefined} options.bundled - the plugin's own executable, when it has one.
* @param {string|undefined} options.bundledDetail - why the plugin's own copy is unusable, when it has none.
* @param {boolean} options.allowSystemFallback - whether system installations may be used.
* @param {NodeJS.ProcessEnv} options.env - the environment to read.
* @param {string} options.platform - `process.platform`.
* @returns {ShellResolution} the resolution.
*/
function resolveBash({ configured, bundled, bundledDetail, allowSystemFallback, env, platform }) {
	if (configured !== void 0) return isSpawnableFile(configured) ? {
		available: true,
		file: configured,
		source: "config",
		detail: "configured bash executable"
	} : {
		available: false,
		file: void 0,
		source: "config",
		detail: `the configured bash executable does not exist: ${configured}`
	};
	if (bundled !== void 0) return {
		available: true,
		file: bundled,
		source: "bundled",
		detail: "the plugin's own bash"
	};
	if (!allowSystemFallback) return {
		available: false,
		file: void 0,
		source: "disabled",
		detail: `no bundled bash and allowSystemShellFallback is false${bundledDetail === void 0 ? "" : ` (${bundledDetail})`}; ${GENERIC_BASH_REMEDY}`
	};
	const onPath = fromPath({
		names: executableNames("bash", platform),
		pathValue: env.PATH ?? env.Path,
		reject: (file) => isWslBashLauncher(file, env, platform)
	});
	if (onPath !== void 0) return {
		available: true,
		file: onPath,
		source: "path",
		detail: "bash found on PATH"
	};
	for (const candidate of wellKnownCandidates({
		kind: "bash",
		env,
		platform
	})) if (isSpawnableFile(candidate)) return {
		available: true,
		file: candidate,
		source: "well-known",
		detail: "well-known bash install"
	};
	return {
		available: false,
		file: void 0,
		source: "missing",
		detail: `no bash found by config, the runtime package, PATH, or a well-known install location${bundledDetail === void 0 ? "" : ` (${bundledDetail})`}; ${GENERIC_BASH_REMEDY}`
	};
}
/**
* Resolve the PowerShell 7 rung.
*
* L3 is "the plugin's own pwsh 7", and whether that rung runs is decided by the
* executable it needs actually being there: `cordis.patch.yml` points the
* host's `pwsh-sandbox` row at this same path whenever it exists, so
* `available` here and the host row's behaviour are one fact, not two. There is
* deliberately no configured-path form: the row the plugin would have to
* rewrite is resolved before any dsh-ops config is read.
* @param {object} options - resolution inputs.
* @param {string|undefined} options.bundled - the plugin's own pwsh, when it has one.
* @param {string|undefined} options.bundledDetail - why the plugin's own copy is unusable, when it has none.
* @param {boolean} options.allowSystemFallback - whether the host's pwsh may serve as the last rung.
* @returns {ShellResolution} the resolution.
*/
function resolvePwsh({ bundled, bundledDetail, allowSystemFallback }) {
	if (bundled !== void 0) return {
		available: true,
		file: bundled,
		source: "bundled",
		detail: "the plugin's own PowerShell 7, which the pwsh-sandbox override points at"
	};
	return {
		available: false,
		file: void 0,
		source: "missing",
		detail: `the plugin carries no PowerShell 7 for this platform${bundledDetail === void 0 ? "" : ` (${bundledDetail})`}; reinstall dsh-ops-lite with optional dependencies enabled on Windows${allowSystemFallback ? "; the host's own pwsh tool is the ladder's last rung" : "; allowSystemShellFallback is false, so the ladder has no PowerShell rung"}`
	};
}
/**
* Resolve both shell rungs for this configuration.
*
* Synchronous, side-effect free, and total: every failure mode becomes a
* resolution with `available: false`, never a throw, because this runs during
* mount where an exception would take the whole plugin down.
* @param {import('./config.js').ResolvedConfig} config - the plugin configuration.
* @param {object} [options] - resolution overrides, for tests and for a host
*   resolving against a different root. Production callers pass none.
* @param {string} [options.bundleRoot] - the plugin package root.
* @param {NodeJS.ProcessEnv} [options.env] - the environment to probe.
* @param {string} [options.platform] - `process.platform`.
* @param {string} [options.arch] - `process.arch`.
* @returns {{bash: ShellResolution, pwsh: ShellResolution}} one resolution per rung.
*/
function resolveShells(config, options = {}) {
	const bundleRoot = options.bundleRoot ?? MODULE_ROOT;
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const allowSystemFallback = config?.allowSystemShellFallback === true;
	const probe = {
		bundleRoot,
		env,
		platform,
		arch
	};
	const pwshBundled = bundledShell({
		kind: "pwsh",
		...probe
	});
	const pwsh = resolvePwsh({
		bundled: pwshBundled.file,
		bundledDetail: pwshBundled.detail,
		allowSystemFallback
	});
	if (config?.publishBashTool === false) return {
		bash: {
			available: false,
			file: void 0,
			source: "disabled",
			detail: "publishBashTool is false"
		},
		pwsh
	};
	const bashBundled = bundledShell({
		kind: "bash",
		...probe
	});
	return {
		bash: resolveBash({
			configured: config?.bashPath,
			bundled: bashBundled.file,
			bundledDetail: bashBundled.detail,
			allowSystemFallback,
			env,
			platform
		}),
		pwsh
	};
}
/**
* Reject a value this tool cannot run with, naming the field.
* @param {string} name - the argument name.
* @param {number} value - the value to check.
* @returns {void}
* @throws {Error} when the value is not a positive finite number.
*/
function assertPositiveFinite(name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${name}: expected a positive finite number, got ${JSON.stringify(value)}`);
}
/**
* Refuse arguments this tool does not declare.
*
* A first-party tool built with the harness's `defineTool` gets its arguments
* checked against the parameter schema before its body runs
* (`dsh-tools/lib/index.js`: `validate(args)` → `ToolArgsError`). This plugin
* registers a plain definition through `ctx.tools.register` instead, to stay
* free of any `@deepseek-ai/*` value import, and that path validates only
* `output.schema`: the model's arguments reach `execute` verbatim. Reading the
* known fields with `args?.name` then drops an undeclared key in silence — the
* call reports success while ignoring what the caller asked for.
*
* `run_in_background` is the costly case, because the host's own `bash` and
* `pwsh` tools really do accept it. A command that never exits (a server, a
* watcher) then runs in the foreground and occupies the call for the whole
* `timeoutMs`, which may be as much as {@link MAX_BASH_TIMEOUT_MS}.
* @param {unknown} args - the model arguments.
* @param {readonly string[]} known - the argument names the schema declares.
* @returns {void}
* @throws {Error} when `args` is not an object, or carries an undeclared key.
*/
function assertKnownArguments(args, known) {
	if (args === void 0 || args === null) return;
	if (typeof args !== "object" || Array.isArray(args)) throw new TypeError(`invalid arguments: expected an object, got ${JSON.stringify(args)}`);
	const unknown = Object.keys(args).filter((key) => !known.includes(key));
	if (unknown.length === 0) return;
	const names = unknown.map((key) => JSON.stringify(key)).join(", ");
	throw new Error(`invalid arguments: unknown ${unknown.length === 1 ? "key" : "keys"} ${names}; this tool accepts ${known.join(", ")}`);
}
/**
* Compose the model-facing text for one settled run.
*
* The shape matches the host's own bash tool
* (`packages/shell/tool-bash/src/render.ts`): the body is stdout, then a marked
* stderr section, then interruption markers, with `[exit code: N]` last so a
* reader can anchor on it. A non-zero exit is reported rather than raised; only
* an infrastructure failure (a spawn failure) rejects the call.
* @param {object} value - the canonical result value.
* @returns {string} the rendered text.
*/
function renderBashResult(value) {
	const stream = (output) => output.truncated ? `${output.text}\n[output truncated; full output: ${output.spillPath ?? "(unavailable)"}]` : output.text;
	const out = stream(value.stdout);
	const err = stream(value.stderr);
	let body = out;
	if (err.length > 0) {
		if (body.length > 0 && !body.endsWith("\n")) body += "\n";
		body += `[stderr]\n${err}`;
	}
	if (body.length === 0) body = "(no output)";
	const markers = [];
	if (value.permission) markers.push(`[${value.permission.code}: ${value.permission.message} ${value.permission.nextAction}]`);
	if (value.error !== void 0) markers.push(`[error: ${value.error}]`);
	if (value.timedOut === true) markers.push(`[timed out after ${value.timeoutMs}ms]`);
	if (value.signal !== void 0) markers.push(`[signal: ${value.signal}]`);
	if (value.exitCode !== void 0 && value.exitCode !== 0) markers.push(`[exit code: ${value.exitCode}]`);
	return [body, ...markers].join("\n");
}
/**
* Read one settled collect-mode stream as its complete retained output.
* @param {{readFrom: (from: number) => {text: string, lossy: boolean, spillPath?: string}}|undefined} reader - the reader.
* @returns {{text: string, truncated: boolean, spillPath?: string}} the canonical stream value.
*/
function settledStream(reader) {
	if (reader === void 0 || typeof reader.readFrom !== "function") return {
		text: "",
		truncated: false
	};
	const read = reader.readFrom(0);
	return {
		text: read.text,
		truncated: read.lossy === true,
		...read.spillPath !== void 0 ? { spillPath: read.spillPath } : {}
	};
}
/**
* The canonical output contract of `ops_bash`, as plain JSON Schema.
*
* EVERY `type` here is a single type string: the harness's
* `assertSupportedJsonSchema` rejects type arrays outright ("type arrays are
* not supported", `packages/core/tools/src/json-schema.ts:302-307`), so
* `['integer', 'null']` is a definition the real registry refuses to register.
* "Nothing to report" is expressed by OMITTING the key, never by a `null`, which
* is why `exitCode` and `signal` are optional rather than nullable.
*/
const BASH_OUTPUT_SCHEMA = Object.freeze({
	type: "object",
	additionalProperties: false,
	required: [
		"timedOut",
		"timeoutMs",
		"stdout",
		"stderr"
	],
	properties: {
		exitCode: { type: "integer" },
		signal: { type: "string" },
		error: { type: "string" },
		permission: { type: "object" },
		sandbox: { type: "object" },
		timedOut: { type: "boolean" },
		timeoutMs: { type: "number" },
		stdout: {
			type: "object",
			additionalProperties: false,
			required: ["text", "truncated"],
			properties: {
				text: { type: "string" },
				truncated: { type: "boolean" },
				spillPath: { type: "string" }
			}
		},
		stderr: {
			type: "object",
			additionalProperties: false,
			required: ["text", "truncated"],
			properties: {
				text: { type: "string" },
				truncated: { type: "boolean" },
				spillPath: { type: "string" }
			}
		}
	}
});
/**
* The model-facing description of the bash rung.
*
* It states the rung's position in the ladder and the recovery step on failure,
* so the model fixes the command instead of switching shells — the same contract
* `lib/policy.js` renders into the prompt.
* @returns {string} the description.
*/
function bashToolDescription() {
	return "Run general commands, builds, git/gh, pipelines and scripts in bash; prefer this command executor over PowerShell. Use file tools for file operations. Each call uses a fresh non-login shell; set workdir explicitly. For scripts longer than about 1 KB or containing heredocs, quotes, backslashes or non-ASCII text, write the script to a file first and pass script_path instead of embedding it in command. Use command for short commands and pipelines. Fix failed bash commands here, do not switch shells or mix PowerShell syntax. Output is bounded with spill paths; verify absolute targets before delete/move. Foreground only: no run_in_background and no job id, so a server or watcher occupies the call until timeoutMs; use host pwsh for background.";
}
/**
* One `ops_bash` tool definition, bound to the resolved bash executable.
*
* The definition is a plain object — no `@deepseek-ai/*` value import, at load
* time or later — and it is registered through the caller's own
* `ctx.tools.register`, never by rewriting the shared registry. Its one host
* dependency, the subprocess service, is read with `ctx.get('subprocess')`:
* reaching a host service through `ctx.get` needs no import, and it buys the
* harness's real credential scrub and process governance instead of a
* hand-rolled spawn.
* @param {object} options - the tool inputs.
* @param {string} options.file - the resolved bash executable.
* @param {string} options.source - where that executable came from, for diagnostics.
* @param {{spawn: (spec: object) => object}} options.subprocess - the harness subprocess service.
* @param {(argv: string[], signal: AbortSignal) => Promise<string[]>} [options.prepareArgv] - prepare authoritative confinement arguments.
* @param {NodeJS.ProcessEnv} [options.env] - explicit child environment overrides.
* @returns {object} the definition `ctx.tools.register()` accepts.
*/
function bashToolDefinition({ file, source, subprocess, prepareArgv, env = {} }) {
	return {
		name: BASH_TOOL_NAME,
		description: bashToolDescription(),
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "Short bash command or pipeline. Omit or leave empty when using script_path."
				},
				description: {
					type: "string",
					description: "Short human-readable description of the command; accepted for compatibility with the host shell tool."
				},
				script_path: {
					type: "string",
					description: "Existing bash script path. Omit or leave empty when using command. Never use /dev/null as a placeholder."
				},
				workdir: {
					type: "string",
					description: "Working directory; defaults to the session workspace when omitted."
				},
				timeoutMs: {
					type: "number",
					description: `Timeout in milliseconds; the command is killed on expiry. Defaults to ${DEFAULT_BASH_TIMEOUT_MS}.`
				},
				graceMs: {
					type: "number",
					description: `Grace period in milliseconds between termination and a forced kill. Defaults to ${DEFAULT_GRACE_MS}.`
				}
			},
			additionalProperties: false
		},
		output: {
			schema: BASH_OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: renderBashResult(value)
			}]
		},
		/**
		* Run one command through the harness subprocess service.
		*
		* The service owns credential scrubbing, output spilling, and process-range
		* termination; this body supplies only the argv, the directory, the budgets,
		* the terminal overrides, and its cancellation.
		* @param {Record<string, unknown>} args - the model arguments.
		* @param {{signal?: AbortSignal}} [exec] - the host execution context.
		* @returns {Promise<object>} the canonical result value.
		*/
		async execute(args, exec) {
			assertKnownArguments(args, BASH_ARGUMENTS);
			if (args?.description !== void 0 && typeof args.description !== "string") throw new Error("invalid description: expected a string");
			const rawCommand = args?.command;
			const rawScriptPath = args?.script_path;
			for (const [name, value] of [["command", rawCommand], ["script_path", rawScriptPath]]) if (value != null && typeof value !== "string") throw new Error(`invalid ${name}: expected a string`);
			const command = typeof rawCommand === "string" && rawCommand.trim() !== "" ? rawCommand : void 0;
			const scriptPath = typeof rawScriptPath === "string" && rawScriptPath.trim() !== "" ? rawScriptPath : void 0;
			const hasCommand = command !== void 0;
			const hasScriptPath = scriptPath !== void 0;
			if (!hasCommand && !hasScriptPath) {
				if (typeof rawCommand === "string") throw new Error("invalid command: expected a non-empty string; omit or leave script_path empty when using command");
				if (typeof rawScriptPath === "string") throw new Error("invalid script_path: expected a non-empty string; omit or leave command empty when using script_path");
				throw new Error("invalid bash input: provide exactly one of command or script_path");
			}
			if (hasCommand && hasScriptPath) throw new Error("invalid bash input: provide exactly one of command or script_path; for commands omit script_path or set it to \"\", not /dev/null");
			const timeoutMs = args?.timeoutMs ?? 12e4;
			assertPositiveFinite("timeoutMs", timeoutMs);
			if (timeoutMs > 2147483647) throw new Error(`invalid timeoutMs: must be no greater than ${MAX_BASH_TIMEOUT_MS}, got ${timeoutMs}`);
			const graceMs = args?.graceMs ?? 3e3;
			assertPositiveFinite("graceMs", graceMs);
			const workdir = args?.workdir;
			if (workdir !== void 0 && typeof workdir !== "string") throw new Error("invalid workdir: expected a string");
			const controller = new AbortController();
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort(/* @__PURE__ */ new Error(`command timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			timer.unref?.();
			const callerSignal = exec?.signal;
			const onCallerAbort = () => controller.abort(callerSignal?.reason);
			if (callerSignal !== void 0) if (callerSignal.aborted) onCallerAbort();
			else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
			try {
				let handle;
				try {
					const argv = hasCommand ? [
						file,
						"-c",
						command
					] : [file, scriptPath];
					const preparedArgv = prepareArgv ? await prepareArgv(argv, controller.signal) : argv;
					handle = subprocess.spawn({
						argv: preparedArgv,
						cwd: workdir,
						stdio: {
							stdin: "ignore",
							stdout: {
								maxBytes: DEFAULT_MAX_OUTPUT_BYTES,
								spill: { maxBytes: DEFAULT_MAX_SPILL_BYTES }
							},
							stderr: {
								maxBytes: DEFAULT_MAX_OUTPUT_BYTES,
								spill: { maxBytes: DEFAULT_MAX_SPILL_BYTES }
							}
						},
						graceMs,
						signal: controller.signal,
						env: {
							...ENV_OVERRIDES,
							...env
						}
					});
					const outcome = await handle.done;
					return {
						...outcome?.exitCode !== void 0 && outcome?.exitCode !== null ? { exitCode: outcome.exitCode } : {},
						...outcome?.signal !== void 0 && outcome?.signal !== null ? { signal: outcome.signal } : {},
						timedOut,
						timeoutMs,
						stdout: settledStream(handle.collected?.stdout),
						stderr: settledStream(handle.collected?.stderr)
					};
				} catch (error) {
					return {
						error: formatBashSpawnError(error, file, source),
						timedOut,
						timeoutMs,
						stdout: {
							text: "",
							truncated: false
						},
						stderr: {
							text: "",
							truncated: false
						}
					};
				}
			} finally {
				clearTimeout(timer);
				callerSignal?.removeEventListener("abort", onCallerAbort);
			}
		}
	};
}
/**
* The one remedy two rungs share: the machine's own bash is not a registry
* artifact, so "fetch it from the registry" is not the advice it needs.
*/
const SYSTEM_BASH_SPAWN_REMEDY = "The system bash this deployment selected is gone; restore the system Bash executable.";
/**
* The remedy one ENOENT deserves, chosen by where the executable came from.
*
* All of these are "the file was there when the rung resolved and is gone now",
* but they are restored by different actions: `bundled` by the profile's own
* dependencies, `provisioned` by running the provisioner again, `config` by the
* operator fixing the path they typed, and `path`/`well-known` by the machine's
* own bash. The single sentence this replaced told all of them to repair the
* profile installation, so most were sent somewhere that could not help.
* @type {Readonly<Record<string, string>>}
*/
const BASH_SPAWN_REMEDY = Object.freeze({
	"bundled": "The bundled bash left the runtime package after resolution; reinstall with optional dependencies enabled.",
	"config": "The configured bashPath no longer exists; point bashPath at a real executable.",
	"path": SYSTEM_BASH_SPAWN_REMEDY,
	"well-known": SYSTEM_BASH_SPAWN_REMEDY
});
/**
* The remedy for a source this table has never seen (D8).
*
* `source` is a closed set today, but it is a string that reaches here from the
* resolution: a future rung must degrade to a line that is still actionable
* rather than to no advice at all, and it must not throw on the way.
*/
const DEFAULT_BASH_SPAWN_REMEDY = `${GENERIC_BASH_REMEDY}.`;
/**
* Convert an infrastructure spawn failure into a concise model-facing result.
*
* Only ENOENT is source-routed: it is the one failure that means "this exact
* executable vanished", and what to do about it depends entirely on which rung
* supplied it. Every other spawn failure keeps the plain message, because the
* rung is not the interesting part of it.
* @param {unknown} error - the failure `ctx.subprocess.spawn` raised.
* @param {string} file - the executable the rung resolved.
* @param {string} source - where that executable came from.
* @returns {string} the model-facing error text.
*/
function formatBashSpawnError(error, file, source) {
	const code = typeof error?.code === "string" ? ` (${error.code})` : "";
	if (error?.code === "ENOENT") return `bash executable is unavailable${code}: ${file}. ${Object.hasOwn(BASH_SPAWN_REMEDY, source) ? BASH_SPAWN_REMEDY[source] : DEFAULT_BASH_SPAWN_REMEDY}`;
	return `bash could not be started${code}: ${String(error?.message ?? error)}`;
}
//#endregion
//#region src/ops/session-shells.js
/** Plugin-owned bash layers; permission changes never mutate the shared registry. */
function mountSessionBash(ctx, config, shells) {
	if (!config.publishBashTool) return;
	const bash = shells.bash;
	if (!bash.available) {
		ctx.logger?.warn?.(`dsh-ops: bash unavailable: ${bash.detail}`);
		return;
	}
	const entries = /* @__PURE__ */ new Map();
	let ready = false;
	let stopped = false;
	const allowed = (agent) => {
		if (!ready || stopped || !agent?.session) return false;
		try {
			const policy = ctx.get("sandboxPolicy")?.resolve({ session: agent.session });
			return MODES.includes(policy?.mode) && (policy.mode === "danger-full-access" || !!ctx.get("sandbox")?.confine);
		} catch {
			return false;
		}
	};
	const clear = (entry) => {
		entry.dispose?.();
		entry.dispose = void 0;
	};
	const reconcile = () => {
		for (const entry of entries.values()) clear(entry);
		for (const [agent, entry] of entries) {
			if (!entry.ctx || !allowed(agent)) continue;
			const definition = bashToolDefinition({
				file: bash.file,
				source: bash.source,
				subprocess: ctx.get("subprocess")
			});
			definition.execute = async (args, exec) => {
				const session = exec?.agent?.session;
				if (!session || !ready || stopped) throw new Error("Bash requires an authoritative DSH session and executor.");
				const policy = ctx.get("sandboxPolicy")?.resolve({ session });
				if (!MODES.includes(policy?.mode)) throw new Error("Invalid authoritative DSH permission mode.");
				let confinement;
				const runtime = policy.mode === "danger-full-access" ? { file: bash.file } : confinedBash(bash.file);
				const value = await bashToolDefinition({
					file: runtime.file,
					source: bash.source,
					env: runtime.env,
					prepareArgv: async (argv, signal) => {
						await prepareWorkspace(policy);
						if (policy.mode !== "danger-full-access") {
							const sandbox = ctx.get("sandbox");
							if (!sandbox?.confine) throw new Error("SANDBOX_UNAVAILABLE: DSH confinement provider is unavailable; no command executed.");
							confinement = await sandbox.confine(argv, policy, signal);
							if (!["full", "partial"].includes(confinement?.enforcement) || !confinement.argv?.length) throw new Error("SANDBOX_UNAVAILABLE: invalid DSH confinement result.");
						}
						const current = ctx.get("sandboxPolicy").resolve({ session });
						if (current.mode !== policy.mode || current.workspaceRoot !== policy.workspaceRoot) throw new Error("DSH permissions changed before execution; no command was started.");
						return confinement?.argv ?? argv;
					},
					subprocess: ctx.get("subprocess")
				}).execute({
					...args,
					workdir: args?.workdir ?? session.header?.cwd
				}, exec);
				const text = `${value.stderr?.text ?? ""}\n${value.error ?? ""}`.toLowerCase();
				if (value.exitCode !== 0 && confinement?.runnerFailureRules?.some((rule) => (!rule.allowedExitCodes || rule.allowedExitCodes.includes(value.exitCode)) && rule.fatalSignatures?.some((s) => text.includes(s.toLowerCase()))) || /couldn't create signal pipe|fatal error.*win32 error|sandbox_unavailable/.test(text)) return {
					...value,
					error: "EXECUTOR_UNAVAILABLE: The bash runtime could not initialize under the DSH sandbox; the command did not run. This is not a user authorization denial. Do not retry or bypass confinement."
				};
				if (value.exitCode !== 0 && confinement?.denialSignatures?.some((s) => text.includes(s.toLowerCase()))) {
					const permission = denied(policy, "command file effects", policy.mode === "read-only" ? "workspace-write" : "danger-full-access").error;
					return {
						...value,
						permission: {
							...permission,
							phase: "execute",
							effectState: "unknown",
							nextAction: `${permission.nextAction} Inspect any earlier command effects before a new attempt.`
						}
					};
				}
				return {
					...value,
					sandbox: {
						mode: policy.mode,
						...confinement ? { enforcement: confinement.enforcement } : {}
					}
				};
			};
			try {
				entry.dispose = entry.ctx.tools.register(definition);
			} catch (error) {
				ctx.logger?.warn?.(`dsh-ops: bash publication failed: ${error.message}`);
			}
		}
		for (const [agent, entry] of entries) {
			if (!entry.ctx || allowed(agent) || stopped) continue;
			if ((ctx.get("tools").schemas(agent) ?? []).some((tool) => tool.name === BASH_TOOL)) try {
				entry.dispose = entry.ctx.tools.restrict({ deny: [BASH_TOOL] });
			} catch (error) {
				ctx.logger?.warn?.(`dsh-ops: inherited bash restriction failed: ${error.message}`);
			}
		}
	};
	const attach = (agent) => {
		if (stopped || !agent?.ctx || entries.has(agent)) return;
		const entry = {
			ctx: void 0,
			fiber: void 0,
			dispose: void 0
		};
		entries.set(agent, entry);
		entry.fiber = agent.ctx.plugin((child) => {
			child.inject(["tools"], (toolsCtx) => {
				entry.ctx = toolsCtx;
				reconcile();
			});
		});
	};
	const detach = (agent) => {
		const entry = entries.get(agent);
		if (!entry) return;
		entries.delete(agent);
		clear(entry);
		reconcile();
		return entry.fiber?.dispose();
	};
	ctx.effect(() => async () => {
		stopped = true;
		await Promise.all([...entries.keys()].map(detach));
	}, "dsh-ops: session bash layers");
	ctx.on("agent/created", ({ agent }) => attach(agent));
	ctx.on("agent/disposed", ({ agent }) => detach(agent));
	ctx.on("session/event", (_session, event) => {
		if (event.type === "sandbox/mode") reconcile();
	});
	ctx.inject(["sandbox"], () => {
		reconcile();
	});
	ctx.inject(["sandboxPolicy", "subprocess"], (authorityCtx) => {
		ready = true;
		reconcile();
		authorityCtx.effect(() => () => {
			ready = false;
			reconcile();
		}, "dsh-ops: bash authority and executor");
	});
	for (const agent of ctx.get("agents")?.list?.() ?? []) attach(agent);
}
//#endregion
//#region src/ops/index.js
/** dsh-ops host half. Own registrations only; no @deepseek-ai value imports. */
function report(ctx, message, level = "error") {
	const logger = ctx?.logger;
	if (typeof logger?.[level] === "function") logger[level](message);
	else if (level === "warn") console.warn(message);
	else console.error(message);
}
function visibleTools(ctx, agent) {
	try {
		return (ctx.get("tools")?.schemas(agent) ?? []).map((schema) => schema.name).filter((tool) => typeof tool === "string");
	} catch {
		return [];
	}
}
function prepareRuntime(ctx, config) {
	try {
		const resolved = resolveBinary({
			binaryPath: config.binaryPath,
			packageRoot: PACKAGE_ROOT
		});
		const probe = probeBinary(resolved.file);
		if (!probe.ok) throw new Error(`Unusable FastCtx at ${resolved.file}: ${probe.detail}`);
		return {
			file: resolved.file,
			source: resolved.source,
			version: probe.version
		};
	} catch (error) {
		report(ctx, `dsh-ops: ${error.message}`);
		if (config.required) throw error;
	}
}
/** Explicit host-shell denial is independent of whether ops commands exist. */
function installHostShellDenial(ctx, config) {
	const denied = new Set(config.deniedHostTools);
	const lifts = /* @__PURE__ */ new Map();
	let warned = false;
	const hide = (agent) => {
		if (lifts.has(agent) || !agent?.ctx) return;
		try {
			const names = (ctx.get("tools").schemas(agent) ?? []).map((tool) => tool.name).filter((name) => denied.has(name));
			if (names.length) lifts.set(agent, agent.ctx.tools.restrict({ deny: names }));
		} catch (error) {
			if (!warned) {
				warned = true;
				report(ctx, `dsh-ops: host shell visibility restriction unavailable: ${error.message}; calls remain denied.`, "warn");
			}
		}
	};
	ctx.on("agent/created", ({ agent }) => hide(agent));
	ctx.on("agent/disposed", ({ agent }) => {
		lifts.get(agent)?.();
		lifts.delete(agent);
	});
	for (const agent of ctx.get("agents")?.list?.() ?? []) hide(agent);
	ctx.effect(() => () => {
		for (const lift of lifts.values()) lift();
		lifts.clear();
	}, "dsh-ops: host shell restrictions");
	ctx.on("tools/pre-execute", (exec, next) => hostShellRefusal({
		toolName: String(exec?.name ?? ""),
		denied
	}) ?? next());
	if (typeof ctx.tools.guard === "function") ctx.effect(() => ctx.tools.guard((exec) => hostShellRefusal({
		toolName: String(exec?.name ?? ""),
		denied
	})?.reason), "dsh-ops: host shell guard");
}
async function mountNativeFile(ctx, config, file) {
	const surface = new NativeFileTools({
		ctx,
		config: {
			...config,
			workerPath: file
		},
		report: (message, level) => report(ctx, message, level)
	});
	ctx.effect(() => () => surface.stop(), "dsh-ops: native file worker");
	const tools = await surface.start();
	if (tools.length) report(ctx, `dsh-ops: native Rust file worker ready; ${tools.length} tools.`, "info");
}
async function mountServer(ctx, config, runtime, component) {
	if (!runtime) return;
	const { FastCtxTools } = await import("./tools-DIuFvBvX.js");
	const background = component === "background";
	const surface = new FastCtxTools({
		ctx,
		config,
		runtime,
		fileTools: !background,
		commandTools: background ? BACKGROUND_TOOLS : [],
		shared: true,
		report: (message, level) => report(ctx, message, level)
	});
	ctx.effect(() => () => surface.stop(), "dsh-ops: fastctx server");
	if (background) {
		ctx.on("agent/created", ({ agent }) => surface.attachAgent(agent));
		ctx.on("agent/disposed", ({ agent }) => surface.detachAgent(agent));
		ctx.on("session/event", (_session, event) => {
			if (event.type === "sandbox/mode") surface.refreshAgents();
		});
		surface.authorityAvailable = false;
		ctx.inject(["sandboxPolicy"], (authorityCtx) => {
			surface.authorityAvailable = true;
			surface.refreshAgents();
			authorityCtx.effect(() => () => {
				surface.authorityAvailable = false;
				surface.refreshAgents();
			}, "dsh-ops: permission authority");
		});
		for (const agent of ctx.get("agents")?.list?.() ?? []) surface.attachAgent(agent);
	}
	try {
		const tools = await surface.start();
		report(ctx, `dsh-ops: FastCtx ${runtime.version} ready; ${component} component, ${tools.length} global tools.`, "info");
	} catch (error) {
		report(ctx, `dsh-ops: FastCtx unavailable: ${error.message}`);
		if (config.required) throw error;
		surface.retryLater();
	}
}
function applyComponent(root, rawConfig, component) {
	const config = resolveConfig(rawConfig);
	const runtime = component === "shell" || component === "file" ? void 0 : prepareRuntime(root, config);
	const nativeWorker = component === "file" ? (() => {
		try {
			return resolveWorker(config);
		} catch (error) {
			report(root, `dsh-ops: native file worker unavailable: ${error.message}`);
			if (config.required) throw new Error(`Native file worker unavailable for binaryPath ${config.binaryPath ?? "(automatic resolution)"}: ${error.message}`);
			return;
		}
	})() : void 0;
	const shells = component === "shell" ? resolveShells(config) : void 0;
	if (shells && config.required && (!shells.bash.available || process.platform === "win32" && !shells.pwsh.available)) throw new Error(`dsh-ops-lite: required shell runtime unavailable: ${!shells.bash.available ? shells.bash.detail : shells.pwsh.detail}`);
	const owned = component === "shell" ? [BASH_TOOL, "pwsh"] : component === "file" ? FILE_TOOLS.map(publicToolName) : BACKGROUND_TOOLS.map(publicToolName);
	if (component === "file") owned.push("read_image");
	if (config.promptPolicy) root.inject(["systemPrompt"], (ctx) => {
		ctx.effect(() => ctx.systemPrompt.section({
			name: `${TOOLING_SECTION}:${component}`,
			order: SECTION_ORDERS[TOOLING_SECTION] + (component === "shell" ? 1 : component === "background" ? 2 : 0),
			interpolate: false,
			text: (context) => renderToolingPolicy({
				published: visibleTools(ctx, context.agent).filter((name) => owned.includes(name)),
				shellComponent: component === "shell",
				pwsh7: shells?.pwsh.available ?? false,
				extraGuidance: config.extraGuidance
			})
		}), `dsh-ops: ${component} tooling`);
	});
	if (component === "shell") {
		mountWorkspacePreparation(root);
		mountBundledPwsh(root, shells);
		root.inject(["tools"], (ctx) => {
			mountSessionBash(ctx, config, shells);
			if (config.shellPolicy === "deny-host-shell") installHostShellDenial(ctx, config);
		});
	} else if (component === "file") root.inject([
		"tools",
		"sandboxPolicy",
		"subprocess"
	], (ctx) => mountNativeFile(ctx, config, nativeWorker));
	else root.inject(["tools"], (ctx) => mountServer(ctx, config, runtime, component));
}
//#endregion
export { resolveShells as n, applyComponent as t };

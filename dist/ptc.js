import { C as PACKAGE_NAME, a as denied, n as prepareWorkspace, p as publicToolName, r as resolveWorker, t as mountWorkspacePreparation } from "./workspace-preparation-CIAhEqtW.js";
import process from "node:process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
//#region src/ops/ptc/contract.js
/** Single native contract drives host schemas, SDK types and callable names. */
const string = { type: "string" };
const integer = { type: "integer" };
const object = (properties, required = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false
});
const PTC_TOOLS = ["batch", "result"];
const PARAMETERS = {
	batch: object({
		root: string,
		action: {
			type: "string",
			enum: [
				"plan",
				"run",
				"resume"
			]
		},
		operations: {
			type: "array",
			maxItems: 512,
			items: object({
				op: {
					type: "string",
					enum: [
						"copy",
						"move",
						"remove"
					]
				},
				path: string,
				to: string
			}, ["op", "path"])
		},
		operationsRef: string,
		protect: {
			type: "array",
			maxItems: 128,
			items: string
		},
		id: string
	}, ["action"]),
	result: object({
		action: {
			type: "string",
			enum: [
				"put",
				"page",
				"release"
			]
		},
		root: string,
		id: string,
		items: {
			type: "array",
			maxItems: 1e4,
			items: { type: "object" }
		},
		offset: {
			...integer,
			minimum: 0
		},
		limit: {
			...integer,
			minimum: 1,
			maximum: 512
		},
		maxBytes: {
			...integer,
			minimum: 512,
			maximum: 65536
		},
		fields: {
			type: "array",
			maxItems: 32,
			items: string
		},
		equals: { type: "object" }
	}, ["action"])
};
const OUTPUT = {
	type: "object",
	properties: {
		id: string,
		root: string,
		status: string,
		phase: string,
		done: integer,
		total: integer,
		failed: integer,
		unknown: integer,
		logicalBytes: integer,
		byteSemantics: string,
		detailsRef: string,
		complete: { type: "boolean" },
		omitted: integer,
		nextAction: string,
		expires: integer,
		items: {
			type: "array",
			items: { type: "object" }
		},
		nextOffset: integer,
		sandbox: object({
			mode: string,
			enforcement: string
		}, ["mode"]),
		error: object({
			code: string,
			phase: string,
			retryable: { type: "boolean" },
			effectState: string,
			nextAction: string,
			message: string
		}, [
			"code",
			"phase",
			"retryable",
			"effectState",
			"nextAction",
			"message"
		])
	}
};
const DESCRIPTIONS = {
	batch: "Preflight and verify copy/move/remove. action=plan requires operations and creates a no-effect audit plan; execute that exact plan with action=resume plus id (do not change it to run). action=run requires operations and executes immediately. root defaults to session cwd; absolute root follows DSH permissions (unrestricted in full access). Operations use relative / paths, no overwrite or link traversal. Page detailsRef with ops_result. Parameter errors return structured error objects.",
	result: "Bounded session-owned result references: put object rows, page with top-level equals/fields and quantity/byte budgets, release results. 24h expiry. Job audits are read-only. References are observations, never authority. Parameter errors return structured error objects; catch errors from legacy ops_* tools separately."
};
function definition(tool, execute) {
	return {
		name: publicToolName(tool),
		description: DESCRIPTIONS[tool],
		parameters: PARAMETERS[tool],
		timeoutMs: 3e5,
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
//#region src/ops/ptc/worker.js
/** Native worker bridge. Every execution uses DSH policy, confinement and process governance. */
function failure(code, message, effectState = "none") {
	return {
		status: "error",
		error: {
			code,
			phase: effectState === "none" ? "preflight" : "execute",
			retryable: false,
			effectState,
			nextAction: effectState === "none" ? "Correct the request or restore host authority." : "Inspect the persistent job manifest; never blindly rerun an interrupted batch.",
			message
		}
	};
}
async function invoke(ctx, file, tool, args, exec, signal) {
	const session = exec?.agent?.session;
	if (!session?.id) return failure("POLICY_DENIED", "An authoritative session identity is required.");
	const policyService = ctx.get("sandboxPolicy");
	const subprocess = ctx.get("subprocess");
	if (!policyService?.resolve || !subprocess?.spawn) return failure("EXECUTOR_UNAVAILABLE", "DSH policy and subprocess services are required.");
	const jobId = tool === "batch" ? args?.action === "run" || args?.action === "plan" ? `j-${randomUUID()}` : args?.id : void 0;
	const errorResult = (code, message, effect = "none") => ({
		...failure(code, message, effect),
		...jobId ? { detailsRef: jobId } : {}
	});
	let policy;
	let confined;
	let spawned = false;
	try {
		policy = policyService.resolve({ session });
		if (![
			"read-only",
			"workspace-write",
			"danger-full-access"
		].includes(policy?.mode) || !path.isAbsolute(policy?.workspaceRoot ?? "")) return failure("POLICY_DENIED", "Invalid authoritative policy.");
		if (args?.root !== void 0 && (typeof args.root !== "string" || !path.isAbsolute(args.root))) return failure("INVALID_ARGUMENT", "root must be an absolute path.");
		const operationRoot = args?.root ?? policy.workspaceRoot;
		const { root: _selectedRoot, ...workerArgs } = args ?? {};
		const readOnly = policy.mode === "read-only";
		if (readOnly && !(tool === "result" && args?.action === "page")) return denied(policy, `${tool} ${args?.action ?? ""}`, "workspace-write", "The user selected read-only. Only existing result pages are permitted; no audit or business data was written.");
		if (policy.mode === "workspace-write") {
			const target = fs.realpathSync.native(operationRoot);
			if (![
				policy.workspaceRoot,
				tmpdir(),
				...process.platform === "win32" ? [] : ["/tmp"]
			].some((root) => {
				let canonical;
				try {
					canonical = fs.realpathSync.native(root);
				} catch {
					canonical = root;
				}
				const relative = path.relative(canonical, target);
				return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
			})) return denied(policy, `${tool} outside the workspace and DSH temporary areas`, "danger-full-access", "The selected root is outside the user-authorized workspace.");
		}
		const input = JSON.stringify({
			root: operationRoot,
			scope: String(session.id),
			tool,
			args: workerArgs,
			read_only: readOnly,
			...jobId ? { job_id: jobId } : {}
		});
		if (Buffer.byteLength(input) > 2 * 1024 * 1024) return failure("OUTPUT_LIMIT", "Request exceeds the 2 MiB byte budget.");
		let argv = [file];
		if (policy.mode !== "danger-full-access") {
			const sandbox = ctx.get("sandbox");
			if (!sandbox?.confine) return failure("SANDBOX_UNAVAILABLE", "No DSH process confinement provider; refusing unconfined execution.");
			await prepareWorkspace(policy);
			confined = await sandbox.confine(argv, policy, signal);
			if (!["full", "partial"].includes(confined?.enforcement) || !Array.isArray(confined.argv) || !confined.argv.length) return failure("SANDBOX_UNAVAILABLE", "Invalid DSH confinement result; refusing unconfined execution.");
			argv = confined.argv;
		}
		signal.throwIfAborted();
		const current = policyService.resolve({ session });
		if (current.mode !== policy.mode || current.workspaceRoot !== policy.workspaceRoot) return failure("POLICY_DENIED", "Authority changed during preparation.");
		const handle = subprocess.spawn({
			argv,
			cwd: policy.workspaceRoot,
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
		if (signal.aborted || outcome.signal) return errorResult("RESULT_UNKNOWN", "Worker interrupted; durable write-ahead records preserve possible effects.", "unknown");
		if (confined && runnerFailure(outcome.exitCode, stderr.text, confined.runnerFailureRules ?? [])) return failure("SANDBOX_UNAVAILABLE", "DSH confinement runner failed before executing the worker.");
		if (stdout.lossy) return errorResult("OUTPUT_LIMIT", "Worker output exceeded the byte budget; operation facts remain in the audit store.", "unknown");
		if (outcome.exitCode !== 0) {
			const denied = confined?.denialSignatures?.some((s) => stderr.text.toLowerCase().includes(s.toLowerCase()));
			return errorResult(denied ? "POLICY_DENIED" : "RESULT_UNKNOWN", "Worker did not return a settled result; inspect audit records.", "unknown");
		}
		let value;
		try {
			value = JSON.parse(stdout.text);
		} catch {
			return errorResult("RESULT_UNKNOWN", "Worker returned invalid JSON; inspect audit records.", "unknown");
		}
		return {
			...value,
			...tool === "batch" ? { root: operationRoot } : {},
			...value.status === "error" && jobId ? { detailsRef: jobId } : {},
			sandbox: {
				mode: policy.mode,
				...confined ? { enforcement: confined.enforcement } : {}
			}
		};
	} catch (error) {
		return errorResult(spawned ? "RESULT_UNKNOWN" : "SANDBOX_UNAVAILABLE", `DSH execution infrastructure failed, not a user authorization denial: ${String(error?.message ?? error)}`, spawned ? "unknown" : "none");
	}
}
function runnerFailure(exitCode, stderr, rules) {
	if (exitCode === 0 || exitCode == null) return false;
	return rules.some((rule) => (!rule.allowedExitCodes || rule.allowedExitCodes.includes(exitCode)) && stderr.split(/\r?\n/).some((line) => !(rule.informationalLines ?? []).some((s) => s.toLowerCase() === line.toLowerCase()) && (rule.fatalSignatures ?? []).some((s) => line.toLowerCase().includes(s.toLowerCase()))));
}
//#endregion
//#region src/ops/ptc/index.js
/**
* PTC-only component. Public prompt assembly identifies the effective presentation;
* never inspect private modeFor/layers, force presentAs, or infer mode from run_code existence.
*/
function resolvePtcConfig(raw = {}) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PTC config must be an object");
	for (const k of Object.keys(raw)) if (!["binaryPath", "required"].includes(k)) throw new Error(`Unknown PTC config key: ${k}`);
	if (raw.binaryPath !== void 0 && typeof raw.binaryPath !== "string") throw new Error("binaryPath must be a string");
	if (raw.required !== void 0 && typeof raw.required !== "boolean") throw new Error("required must be boolean");
	return raw;
}
async function ptcOnly(ctx, agent, signal) {
	if (!agent?.ctx || !ctx.get("ptcRuntime")) return false;
	const assembly = await ctx.get("systemPrompt").assemble({
		scope: agent,
		signal
	});
	return assembly.tools.length === 1 && assembly.tools[0].name === "run_code" && assembly.sections.some((section) => section.name === "tools:ptc-only" && section.text.trim() !== "");
}
function apply$1(root, rawConfig) {
	const config = resolvePtcConfig(rawConfig);
	mountWorkspacePreparation(root);
	let file;
	try {
		file = resolveWorker(config);
	} catch (e) {
		if (config.required) throw e;
		root.logger?.warn?.(`dsh-ops: ${e.message}`);
		return;
	}
	root.inject([
		"tools",
		"systemPrompt",
		"sandboxPolicy",
		"subprocess"
	], (ctx) => {
		const entries = /* @__PURE__ */ new Map();
		const active = /* @__PURE__ */ new Map();
		let stopped = false;
		let mutating = false;
		let epoch = 0;
		let chain = Promise.resolve();
		const clear = (entry) => {
			for (const dispose of entry.disposers.splice(0)) dispose();
		};
		const reconcile = () => {
			if (stopped || mutating) return;
			const version = ++epoch;
			mutating = true;
			for (const entry of entries.values()) clear(entry);
			mutating = false;
			chain = chain.then(async () => {
				if (stopped || version !== epoch) return;
				const ready = [];
				for (const [agent, entry] of entries) if (entry.ctx && await ptcOnly(ctx, agent).catch(() => false)) ready.push([agent, entry]);
				if (stopped || version !== epoch) return;
				mutating = true;
				try {
					for (const [agent, entry] of ready) for (const tool of PTC_TOOLS) entry.disposers.push(entry.ctx.tools.register(definition(tool, async (args, exec) => {
						if (stopped || entries.get(agent) !== entry || exec?.agent !== agent || !await ptcOnly(ctx, agent, exec.signal).catch(() => false)) return failure("POLICY_DENIED", "The calling scope must be in authoritative PTC-only presentation.");
						if (stopped || entries.get(agent) !== entry) return failure("POLICY_DENIED", "PTC component or owning scope was disposed during preparation.");
						const controller = new AbortController();
						const abort = () => controller.abort(exec.signal?.reason);
						if (exec.signal?.aborted) abort();
						else exec.signal?.addEventListener("abort", abort, { once: true });
						const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error("Worker deadline exceeded")), 3e5);
						timer.unref?.();
						const work = monitoredInvoke(ctx, file, tool, args, exec, controller);
						active.set(controller, {
							owner: agent,
							promise: work
						});
						try {
							return await work;
						} finally {
							clearTimeout(timer);
							active.delete(controller);
							exec.signal?.removeEventListener("abort", abort);
						}
					})));
					for (const [agent, entry] of entries) if (entry.ctx && !ready.some(([a]) => a === agent)) {
						const names = ctx.get("tools").schemas(agent).map((s) => s.name);
						const deny = PTC_TOOLS.map(publicToolName).filter((n) => names.includes(n));
						if (deny.length) entry.disposers.push(entry.ctx.tools.restrict({ deny }));
					}
				} finally {
					mutating = false;
				}
			}).catch((e) => ctx.logger?.warn?.(`dsh-ops: PTC publication failed: ${e.message}`));
		};
		const attach = (agent) => {
			if (stopped || entries.has(agent) || !agent?.ctx) return;
			const entry = {
				disposers: [],
				ctx: void 0,
				fiber: void 0
			};
			entries.set(agent, entry);
			entry.fiber = agent.ctx.plugin((child) => {
				child.inject(["tools"], (scoped) => {
					entry.ctx = scoped;
					reconcile();
				});
			});
		};
		const detach = (agent) => {
			const entry = entries.get(agent);
			if (!entry) return;
			entries.delete(agent);
			mutating = true;
			clear(entry);
			mutating = false;
			entry.fiber?.dispose();
			reconcile();
		};
		ctx.on("agent/created", ({ agent }) => attach(agent));
		ctx.on("agent/disposed", ({ agent }) => {
			for (const [controller, work] of active) if (work.owner === agent) controller.abort(/* @__PURE__ */ new Error("Owning agent disposed"));
			detach(agent);
		});
		ctx.on("tools/change", reconcile);
		ctx.on("session/event", (_session, event) => {
			if (event.type === "sandbox/mode") {
				for (const controller of active.keys()) controller.abort(/* @__PURE__ */ new Error("Sandbox authority changed"));
				reconcile();
			}
		});
		ctx.effect(() => async () => {
			stopped = true;
			++epoch;
			for (const controller of active.keys()) controller.abort(/* @__PURE__ */ new Error("PTC component unloaded"));
			await Promise.allSettled([...active.values()].map((work) => work.promise));
			mutating = true;
			for (const entry of entries.values()) clear(entry);
			await Promise.all([...entries.values()].map((e) => e.fiber?.dispose()));
			entries.clear();
			await chain;
		}, "dsh-ops: native PTC lifecycle");
		for (const agent of ctx.get("agents")?.list?.() ?? []) attach(agent);
	});
}
/**
* Reuse host job admission/ownership/kill when a controller is mounted. Otherwise
* the same foreground work remains bounded by the host call signal and deadline.
* Durable audit IDs are NOT a second background-job scheduler.
*/
async function monitoredInvoke(ctx, file, tool, args, exec, controller) {
	const jobs = ctx.get("jobs");
	if (tool !== "batch" || typeof jobs?.start !== "function") return invoke(ctx, file, tool, args, exec, controller.signal);
	let work, id;
	try {
		id = jobs.start({
			kind: "ops",
			label: `ops_batch ${args?.action ?? ""}`,
			owner: exec.agent.session.id,
			outputLimitBytes: 4096,
			run(job) {
				job.updateProgress(`preflight 0/${args?.operations?.length ?? "?"} errors=0`);
				work = invoke(ctx, file, tool, args, exec, controller.signal).then((value) => {
					job.updateProgress(`${value.phase ?? "settled"} ${value.done ?? 0}/${value.total ?? "?"} errors=${value.failed ?? 0} unknown=${value.unknown ?? 0}`);
					return value;
				});
				return {
					cancel: (reason) => controller.abort(new Error(reason ?? "Host job cancelled")),
					done: work.then((value) => ({
						status: controller.signal.aborted ? "killed" : value.status === "completed" || value.status === "planned" ? "completed" : "failed",
						result: JSON.stringify(value)
					}), (error) => ({
						status: "failed",
						detail: String(error)
					}))
				};
			}
		});
	} catch (e) {
		ctx.logger?.warn?.(`dsh-ops: host job admission unavailable; using bounded foreground execution: ${e.message}`);
		return work ?? invoke(ctx, file, tool, args, exec, controller.signal);
	}
	const value = await work;
	try {
		await jobs.wait(id, 1e3, exec.agent.session.id);
		jobs.remove(id, exec.agent.session.id);
	} catch {}
	return value;
}
//#endregion
//#region src/ptc.ts
const name = `${PACKAGE_NAME}/ptc`;
const inject = [
	"tools",
	"systemPrompt",
	"sandboxPolicy",
	"subprocess"
];
function apply(ctx) {
	apply$1(ctx, { required: true });
}
//#endregion
export { apply, inject, name };

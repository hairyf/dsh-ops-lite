import { c as MAX_TOOL_CALL_TIMEOUT_MS, i as upstreamModule, l as OFFICIAL_TOOLS, o as ABSOLUTE_RUNTIME_PATH, r as resolveRuntimes, s as DEFAULT_CONFIG, t as resolveNativeWorker, u as PACKAGE_NAME } from "./runtimes-YGwsfeEV.js";
import process from "node:process";
import Schema from "@deepseek-ai/schemastery";
//#region src/config.ts
const runtimePath = Schema.string().pattern(ABSOLUTE_RUNTIME_PATH).default("");
const Config = Schema.object({
	enableShell: Schema.boolean().default(DEFAULT_CONFIG.enableShell).description("启用 Shell 组件"),
	enableFile: Schema.boolean().default(DEFAULT_CONFIG.enableFile).description("启用文件组件"),
	enableBackground: Schema.boolean().default(DEFAULT_CONFIG.enableBackground).description("启用后台任务组件"),
	enablePtc: Schema.boolean().default(DEFAULT_CONFIG.enablePtc).description("启用程序化工具调用组件"),
	disableOfficialTools: Schema.boolean().default(DEFAULT_CONFIG.disableOfficialTools).description("禁用官方基础工具，不改变权限或沙箱"),
	runtimeMode: Schema.union(["local-first", "managed"]).default(DEFAULT_CONFIG.runtimeMode).description("运行时来源模式"),
	allowLocalRuntimes: Schema.boolean().default(DEFAULT_CONFIG.allowLocalRuntimes).description("明确授权使用未经固定摘要校验的本机运行时"),
	bashPath: runtimePath.description("本机 Bash 可执行文件的绝对路径；留空自动发现"),
	pwshPath: runtimePath.description("本机 PowerShell 7 可执行文件的绝对路径；留空自动发现"),
	fastctxPath: runtimePath.description("本机 FastCtx 可执行文件的绝对路径；留空自动发现"),
	workerPath: runtimePath.description("文件 worker 的绝对路径；留空使用插件随附副本"),
	promptPolicy: Schema.boolean().default(DEFAULT_CONFIG.promptPolicy).description("提供工具路由与权限说明"),
	publishBashTool: Schema.boolean().default(DEFAULT_CONFIG.publishBashTool).description("在权限允许且执行器可用时发布 ops_bash"),
	enableShellTools: Schema.boolean().default(DEFAULT_CONFIG.enableShellTools).description("在权限允许时发布后台命令工具"),
	required: Schema.boolean().default(DEFAULT_CONFIG.required).description("所需运行时不可用时明确报错"),
	toolCallTimeoutMs: Schema.natural().min(1).max(MAX_TOOL_CALL_TIMEOUT_MS).default(DEFAULT_CONFIG.toolCallTimeoutMs).description("FastCtx 调用等待超时（毫秒）"),
	extraGuidance: Schema.string().default(DEFAULT_CONFIG.extraGuidance).description("附加工具使用说明")
}).default({}).volatile();
//#endregion
//#region src/index.ts
const name = PACKAGE_NAME;
const inject = ["tools"];
function disableOfficialTools(ctx) {
	const denied = new Set(OFFICIAL_TOOLS);
	const lifts = /* @__PURE__ */ new Map();
	let updating = false;
	const refresh = () => {
		if (updating) return;
		updating = true;
		try {
			for (const agent of ctx.get("agents")?.list() ?? []) {
				const owned = lifts.get(agent) ?? /* @__PURE__ */ new Map();
				lifts.set(agent, owned);
				for (const tool of ctx.tools.schemas(agent)) {
					if (!denied.has(tool.name) || owned.has(tool.name)) continue;
					try {
						owned.set(tool.name, agent.ctx.tools.restrict({ deny: [tool.name] }));
					} catch (error) {
						if (!(error instanceof Error) || !error.message.startsWith("tools.restrict() names unknown global tool \"")) throw error;
					}
				}
			}
		} finally {
			updating = false;
		}
	};
	ctx.on("agent/created", () => {
		refresh();
	});
	ctx.on("agent/disposed", ({ agent }) => {
		const owned = lifts.get(agent);
		lifts.delete(agent);
		for (const lift of owned?.values() ?? []) lift();
	});
	ctx.on("tools/change", refresh);
	ctx.effect(() => ctx.tools.guard((exec) => denied.has(exec.name) ? "Official basic tools are disabled by dsh-ops-next. Use the enabled ops_* capabilities or change the plugin setting." : void 0), "dsh-ops-next: official tool execution denial");
	ctx.effect(() => () => {
		updating = true;
		for (const owned of lifts.values()) for (const lift of owned.values()) lift();
		lifts.clear();
	}, "dsh-ops-next: restore official tool visibility");
	refresh();
}
async function mount(ctx, config) {
	const [runtimes, worker] = await Promise.all([resolveRuntimes(config), resolveNativeWorker(config)]);
	const status = {
		components: {
			shell: config.enableShell,
			file: config.enableFile,
			background: config.enableBackground,
			ptc: config.enablePtc
		},
		runtimeMode: config.runtimeMode,
		allowLocalRuntimes: config.allowLocalRuntimes,
		disableOfficialTools: config.disableOfficialTools,
		runtimes: {
			...runtimes,
			worker
		}
	};
	ctx.effect(() => ctx.tools.register({
		name: "ops_status",
		description: "Report enabled Ops components, runtime provenance, compatibility failures and explicit provisioning instructions. Never downloads or installs software.",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true
			},
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		async execute(args) {
			if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("ops_status accepts an empty object only.");
			return status;
		},
		isConcurrencySafe: () => true
	}), "dsh-ops-next: diagnostics");
	if (config.disableOfficialTools) disableOfficialTools(ctx);
	const ensure = (runtime, component) => {
		if (runtime.available) return true;
		const message = `${component}: ${runtime.detail}`;
		if (config.required) throw new Error(message);
		ctx.logger.warn(message);
		return false;
	};
	const upstream = await import(upstreamModule("index.js"));
	const common = {
		required: config.required,
		promptPolicy: config.promptPolicy,
		...config.extraGuidance ? { extraGuidance: config.extraGuidance } : {},
		toolCallTimeoutMs: config.toolCallTimeoutMs,
		enableShellTools: config.enableShellTools,
		allowSystemShellFallback: false,
		configUpdateVersion: 1,
		...runtimes.bash.file ? { bashPath: runtimes.bash.file } : {}
	};
	if (config.enableShell) {
		if (config.publishBashTool) ensure(runtimes.bash, "Bash");
		if (process.platform === "win32") ensure(runtimes.pwsh, "PowerShell 7");
		upstream.applyComponent(ctx, {
			...common,
			publishBashTool: config.publishBashTool && runtimes.bash.available
		}, "shell", { shells: runtimes });
	}
	if (config.enableFile && ensure(worker, "Native file tools")) upstream.applyComponent(ctx, {
		...common,
		binaryPath: worker.file
	}, "file");
	if (config.enableBackground && config.enableShellTools && ensure(runtimes.fastctx, "Background jobs") && ensure(runtimes.bash, "Background Bash")) upstream.applyComponent(ctx, {
		...common,
		binaryPath: runtimes.fastctx.file
	}, "background");
	if (config.enablePtc && ensure(worker, "PTC")) (await import(upstreamModule("ptc/index.js"))).apply(ctx, {
		binaryPath: worker.file,
		required: config.required
	});
}
/** Rebuild only our owned capability fiber after one atomic settings commit. */
async function apply(ctx, config) {
	let current;
	let stopped = false;
	let chain = Promise.resolve();
	const reconcile = () => {
		const snapshot = { ...config.get() };
		chain = chain.catch(() => {}).then(async () => {
			await current?.dispose();
			current = void 0;
			if (stopped) return;
			current = ctx.plugin((child) => mount(child, snapshot));
			await current.await();
		});
		return chain;
	};
	ctx.on("loader/volatile-update", () => reconcile().catch((error) => ctx.logger.error(error)));
	ctx.effect(() => async () => {
		stopped = true;
		await chain.catch(() => {});
		await current?.dispose();
	}, "dsh-ops-next: component lifecycle");
	await reconcile();
}
//#endregion
export { Config, apply, inject, name };

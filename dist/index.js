import { C as PACKAGE_NAME, S as OFFICIAL_TOOL_SECTIONS, b as OFFICIAL_TOOLS, x as OFFICIAL_TOOLS_DESCRIPTION, y as DEFAULT_CONFIG } from "./workspace-preparation-BurRV1lU.js";
import { t as applyComponent } from "./ops-C700ahzC.js";
import { renderToolsSdk, renderToolsSdkPy } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
//#region src/config.ts
const Config = Schema.object({ disableOfficialTools: Schema.boolean().default(DEFAULT_CONFIG.disableOfficialTools).description(OFFICIAL_TOOLS_DESCRIPTION) }).default({}).volatile();
//#endregion
//#region src/index.ts
const name = PACKAGE_NAME;
const inject = [
	"tools",
	"sandboxPolicy",
	"subprocess"
];
function disableOfficialTools(ctx) {
	const denied = new Set(OFFICIAL_TOOLS);
	const hiddenSections = new Set(OFFICIAL_TOOL_SECTIONS);
	const lifts = /* @__PURE__ */ new Map();
	ctx.inject(["systemPrompt"], (branch) => {
		branch.on("system-prompt/assemble", async (_assembly, context, next) => {
			const assembly = await next();
			if (!context.agent) return assembly;
			let sdk;
			if (assembly.sections.some((section) => section.name === "tools:sdk" && section.text.length > 0)) {
				const schemas = [];
				for (const schema of ctx.tools.schemas(context.agent)) {
					const definition = ctx.tools.get(schema.name, context.agent);
					if (definition && schema.name !== "run_code" && !denied.has(schema.name)) schemas.push({
						...schema,
						output: definition.output.schema
					});
				}
				const language = ctx.get("ptcRuntime")?.language;
				if (language === "typescript") sdk = renderToolsSdk(schemas);
				else if (language === "python") sdk = renderToolsSdkPy(schemas);
				else throw new Error(`Cannot filter the official tools from PTC SDK language ${String(language)}`);
			}
			return {
				...assembly,
				tools: assembly.tools.filter((tool) => !denied.has(tool.name)),
				sections: assembly.sections.filter((section) => !hiddenSections.has(section.name)).map((section) => section.name === "tools:sdk" && sdk !== void 0 ? {
					...section,
					text: sdk,
					interpolate: false
				} : section)
			};
		});
	});
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
	ctx.effect(() => ctx.tools.guard((exec) => denied.has(exec.name) ? "Official basic tools are disabled by dsh-ops-lite. Use the enabled ops_* capabilities or change the plugin setting." : void 0), "dsh-ops-lite: official tool execution denial");
	ctx.effect(() => () => {
		updating = true;
		for (const owned of lifts.values()) for (const lift of owned.values()) lift();
		lifts.clear();
	}, "dsh-ops-lite: restore official tool visibility");
	refresh();
}
/** The bundle mounts each capability from its independently owned loader row. */
async function apply(ctx, config) {
	applyComponent(ctx, { required: true }, "file");
	let current;
	let stopped = false;
	let chain = Promise.resolve();
	const reconcile = () => {
		const snapshot = { ...config.get() };
		chain = chain.catch(() => {}).then(async () => {
			await current?.dispose();
			current = void 0;
			if (stopped) return;
			if (snapshot.disableOfficialTools) {
				current = ctx.plugin(disableOfficialTools);
				await current.await();
			}
		});
		return chain;
	};
	ctx.on("loader/volatile-update", () => reconcile().catch((error) => ctx.logger.error(error)));
	ctx.effect(() => async () => {
		stopped = true;
		await chain.catch(() => {});
		await current?.dispose();
	}, "dsh-ops-lite: official tool policy");
	await reconcile();
}
//#endregion
export { Config, apply, inject, name };

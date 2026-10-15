import { c as FILE_TOOLS, h as PACKAGE_ROOT, o as BACKGROUND_TOOLS, p as publicToolName, u as SHELL_TOOLS } from "./workspace-preparation-CIAhEqtW.js";
import { n as resolveShells } from "./ops-VI4sL4Kk.js";
import process from "node:process";
import { spawn } from "node:child_process";
import path from "node:path";
//#region src/ops/handshake.js
/**
* The MCP stdio client this plugin owns.
*
* It is the plugin's transport: `lib/tools.js` keeps one long-lived client
* connected to the FastCtx server for as long as the plugin is mounted, calls
* `tools/call` through it, and rebuilds the whole tool generation after a
* reconnect. The same client also serves the callers that need ground truth
* without a host — `dsh-ops status`, and the suite that pins the tool surface
* the plugin's prompt policy advertises.
*
* It speaks newline-delimited JSON-RPC 2.0 and implements only the four methods
* those callers use.
*
* @module dsh-ops/handshake
*/
/** Exact owned clients only: never enumerate/kill shared runtime-host processes. */
const ownedClients = /* @__PURE__ */ new Set();
function stopOwnedClients() {
	for (const client of ownedClients) if (client.exitInfo === void 0) client.child.kill();
}
function track(client) {
	if (ownedClients.size === 0) process.on("exit", stopOwnedClients);
	ownedClients.add(client);
}
function untrack(client) {
	ownedClients.delete(client);
	if (ownedClients.size === 0) process.removeListener("exit", stopOwnedClients);
}
/** The MCP revision this client announces. */
const PROTOCOL_VERSION = "2025-06-18";
/** Error raised when the server does not answer in time. */
var McpTimeoutError = class extends Error {
	/**
	* @param {string} method - the unanswered method.
	* @param {number} timeoutMs - the deadline that expired.
	*/
	constructor(method, timeoutMs) {
		super(`MCP server did not answer ${method} within ${timeoutMs} ms`);
		this.name = "McpTimeoutError";
		this.method = method;
	}
};
/** Error raised when the server answers with a JSON-RPC error. */
var McpServerError = class extends Error {
	/**
	* @param {string} method - the failing method.
	* @param {{code?: number, message?: string}} error - the JSON-RPC error object.
	*/
	constructor(method, error) {
		super(`MCP ${method} failed: ${error?.message ?? JSON.stringify(error)}`);
		this.name = "McpServerError";
		this.code = error?.code;
	}
};
/** One newline-delimited JSON-RPC client over a spawned server's stdio. */
var McpStdioClient = class McpStdioClient {
	/**
	* @param {import('node:child_process').ChildProcess} child - the spawned server.
	* @param {number} timeoutMs - the default per-request deadline.
	*/
	constructor(child, timeoutMs) {
		this.child = child;
		this.timeoutMs = timeoutMs;
		this.nextId = 1;
		/** @type {Map<number, {resolve: (value: unknown) => void, reject: (error: Error) => void, method: string}>} */
		this.pending = /* @__PURE__ */ new Map();
		/** @type {string[]} */
		this.stderrLines = [];
		this.buffer = "";
		this.closed = false;
		this.closing = void 0;
		track(this);
		/** How this connection ended, or undefined while it is live. */
		this.exitInfo = void 0;
		/**
		* Settles once this connection is over, however it ended: a clean exit, a
		* crash, or a spawn failure. A long-lived owner watches it to notice a dead
		* server between calls instead of discovering it on the next timeout.
		* @type {Promise<{code: number|null, signal: string|null, error?: Error}>}
		*/
		this.exited = new Promise((resolve) => {
			this.resolveExit = resolve;
		});
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => this.#ingest(chunk));
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			for (const line of String(chunk).split("\n")) if (line.trim() !== "") this.stderrLines.push(line);
		});
		child.stdin.on("error", () => {});
		const settleExit = (info) => {
			if (this.exitInfo !== void 0) return;
			this.exitInfo = info;
			untrack(this);
			this.closed = true;
			const reason = info.error !== void 0 ? /* @__PURE__ */ new Error(`MCP server could not be started: ${info.error.message}`) : /* @__PURE__ */ new Error(`MCP server exited (code ${info.code ?? "null"}, signal ${info.signal ?? "none"})`);
			for (const entry of this.pending.values()) entry.reject(reason);
			this.pending.clear();
			this.resolveExit(info);
		};
		child.once("exit", (code, signal) => settleExit({
			code,
			signal
		}));
		child.once("error", (error) => settleExit({
			code: null,
			signal: null,
			error
		}));
		child.stdout.once("end", () => {
			if (!this.closed) this.close().catch(() => {});
		});
	}
	/**
	* Spawn one server and return a connected client (the MCP handshake is not
	* performed; call {@link McpStdioClient#initialize}).
	* @param {object} options - spawn inputs.
	* @param {string} options.file - the executable.
	* @param {string[]} [options.args] - its arguments.
	* @param {string} [options.cwd] - working directory.
	* @param {NodeJS.ProcessEnv} [options.env] - environment.
	* @param {number} [options.timeoutMs] - the default per-request deadline.
	* @returns {McpStdioClient} the client.
	*/
	static start({ file, args = [], cwd, env = process.env, timeoutMs = 6e4 }) {
		const child = spawn(file, args, {
			cwd,
			env: {
				...env,
				FASTCTX_NO_PARENT_WATCH: "0"
			},
			windowsHide: true,
			stdio: [
				"pipe",
				"pipe",
				"pipe"
			]
		});
		return new McpStdioClient(child, timeoutMs);
	}
	/**
	* Consume whatever arrived and settle every complete line.
	* @param {string} chunk - decoded stdout.
	* @returns {void}
	*/
	#ingest(chunk) {
		this.buffer += chunk;
		for (let index = this.buffer.indexOf("\n"); index >= 0; index = this.buffer.indexOf("\n")) {
			const line = this.buffer.slice(0, index).trim();
			this.buffer = this.buffer.slice(index + 1);
			if (line === "") continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				this.stderrLines.push(`non-JSON stdout: ${line.slice(0, 400)}`);
				continue;
			}
			const entry = message.id === void 0 ? void 0 : this.pending.get(message.id);
			if (entry === void 0) continue;
			if (message.error !== void 0) entry.reject(new McpServerError(entry.method, message.error));
			else entry.resolve(message.result);
		}
	}
	/**
	* Send one request and await its result.
	* @param {string} method - the JSON-RPC method.
	* @param {Record<string, unknown>} [params] - its parameters.
	* @param {object} [options] - per-request overrides.
	* @param {number} [options.timeoutMs] - this request's deadline.
	* @param {AbortSignal} [options.signal] - cancels this request when aborted.
	* @returns {Promise<any>} the result.
	*/
	request(method, params = {}, options = {}) {
		const { timeoutMs = this.timeoutMs, signal } = options;
		if (this.closed) return Promise.reject(/* @__PURE__ */ new Error(`MCP server is gone; cannot send ${method}`));
		if (signal?.aborted === true) return Promise.reject(/* @__PURE__ */ new Error(`MCP ${method} was canceled before it was sent`));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			let timer;
			let settled = false;
			const finish = (settle, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				this.pending.delete(id);
				settle(value);
			};
			function onAbort() {
				finish(reject, /* @__PURE__ */ new Error(`MCP ${method} was canceled`));
			}
			timer = setTimeout(() => finish(reject, new McpTimeoutError(method, timeoutMs)), timeoutMs);
			timer.unref?.();
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, {
				method,
				resolve: (value) => finish(resolve, value),
				reject: (error) => finish(reject, error)
			});
			this.child.stdin.write(`${JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params
			})}\n`);
		});
	}
	/**
	* Send one notification (no reply is expected).
	* @param {string} method - the JSON-RPC method.
	* @param {Record<string, unknown>} [params] - its parameters.
	* @returns {void}
	*/
	notify(method, params = {}) {
		if (this.closed) return;
		this.child.stdin.write(`${JSON.stringify({
			jsonrpc: "2.0",
			method,
			params
		})}\n`);
	}
	/**
	* Perform the MCP handshake.
	* @param {string} [clientName] - the name to announce.
	* @returns {Promise<{protocolVersion: string, serverInfo: {name: string, version: string}, instructions?: string, capabilities: Record<string, unknown>}>} the server's answer.
	*/
	async initialize(clientName = "dsh-ops") {
		const result = await this.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: {
				name: clientName,
				version: "0.1.0"
			}
		});
		this.notify("notifications/initialized", {});
		return result;
	}
	/**
	* List the server's tools.
	* @returns {Promise<{name: string, description?: string, inputSchema?: Record<string, unknown>, outputSchema?: Record<string, unknown>}[]>} the tools.
	*/
	async listTools() {
		return (await this.request("tools/list", {}))?.tools ?? [];
	}
	/**
	* Call one tool and return its raw result.
	* @param {string} toolName - the server's own tool name.
	* @param {Record<string, unknown>} args - the arguments.
	* @param {object} [options] - per-request overrides (deadline, cancellation).
	* @returns {Promise<{content?: unknown[], isError?: boolean, structuredContent?: unknown}>} the result.
	*/
	async callTool(toolName, args, options = {}) {
		return this.request("tools/call", {
			name: toolName,
			arguments: args
		}, options);
	}
	/**
	* Stop the server and wait for the process to settle.
	*
	* Idempotent, and safe to call on a connection that already ended: the
	* process is only signalled while it is still alive.
	* @returns {Promise<void>} resolves once the child is gone.
	*/
	close() {
		if (this.closing) return this.closing;
		if (this.exitInfo !== void 0) return Promise.resolve();
		this.closed = true;
		for (const entry of this.pending.values()) entry.reject(/* @__PURE__ */ new Error("MCP client is closing"));
		this.pending.clear();
		this.closing = this.#stopChild();
		return this.closing;
	}
	async #stopChild() {
		this.child.stdin.end();
		this.child.kill();
		let timer;
		try {
			await Promise.race([this.exited, new Promise((resolve, reject) => {
				timer = setTimeout(() => {
					this.child.kill("SIGKILL");
					timer = setTimeout(() => reject(/* @__PURE__ */ new Error("MCP child did not exit after forced shutdown")), 2e3);
				}, 2e3);
			})]);
		} finally {
			clearTimeout(timer);
		}
	}
};
//#endregion
//#region src/ops/jobs.js
const ENTRY = new RegExp(`^(j-[a-z0-9]{6}) (?:running \\d+(?:s|m\\d+s|h\\d+m)|exited -?\\d+|killed|interrupted)$`);
function startedJob(value) {
	for (const block of value.content ?? []) {
		if (block.type !== "text") continue;
		const match = /(?:^|\n)\(Complete: job (j-[a-z0-9]{6}) started; log at [^\n]*\.\)\s*$/.exec(block.text);
		if (match) return match[1];
	}
}
/** Only touch the final server decoration, never arbitrary lines in command output. */
function cleanBackground(value, owned) {
	const content = [...value.content];
	const index = content.findLastIndex((block) => block?.type === "text");
	if (index < 0) return value;
	const block = content[index];
	const text = block.text;
	if (typeof text !== "string") return value;
	const match = /(?:^|\n)\(Background: ([^\n]*)\.\)(?=\s*(?:\((?:Complete|Partial|Killed):[^\n]*\)\s*)?$)/.exec(text);
	if (!match) return value;
	const entries = match[1].split(", ");
	if (!entries.every((entry) => ENTRY.test(entry)) && !/^\d+ jobs? running$/.test(match[1])) return value;
	const kept = entries.filter((entry) => {
		const parsed = ENTRY.exec(entry);
		return parsed && owned.has(parsed[1]);
	});
	const replacement = kept.length ? `${match[0].startsWith("\n") ? "\n" : ""}(Background: ${kept.join(", ")}.)` : "";
	content[index] = {
		...block,
		text: text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length)
	};
	return {
		...value,
		content
	};
}
/** Parse only the upstream job-list entry boundaries, not arbitrary output text. */
function jobEntries(value) {
	const text = value.content.filter((block) => block?.type === "text").map((block) => block.text).join("\n");
	const entries = [];
	for (const match of text.matchAll(/(?:^|\n\n)(j-[a-z0-9]{6}) {2}(running|killed|exited -?\d+|interrupted); started ([^\n]*)\n {2}([^\n]*)/g)) entries.push({
		id: match[1],
		status: match[2],
		text: match[0].trimStart()
	});
	const next = /\(Partial:[^\n]*\boffset[=: ]+(\d+)/.exec(text);
	return {
		entries,
		next: next ? Number(next[1]) : void 0,
		partial: /(?:^|\n)\(Partial:/.test(text)
	};
}
//#endregion
//#region src/ops/presentation.js
/** Compact presentation only; arguments are forwarded unchanged. */
const DESCRIPTIONS = {
	inspect_local_file: "Read text ranges (prefer files[] batches, up to 32), known encodings, PDF text or hex. Images: use host read_image.",
	grep: "Search contents with ripgrep; glob[] supports batched filters and ! exclusions. Use summary/count/files_with_matches to reduce output.",
	glob: "Find paths. Prefer pattern[] batches with ! exclusions; choose paths or details output.",
	replace: "Mechanical replacement across files; use host edit for precise changes. Check dry-run results before applying.",
	run: "Run a bash command (not PowerShell), returning bounded output and exit status.",
	run_background: "Start a bash job; keep the returned job ID for output and termination in this session.",
	job_output: "Read output of a job started in this session; use after_seq for explicit continuation.",
	job_list: "List only jobs started in this session and connection; status and pagination apply to owned jobs.",
	job_kill: "Terminate the process tree of a job started in this session."
};
const FIELDS = {
	file_path: "Absolute local path, not a URI; exclusive with files.",
	path: "Absolute local path, not a URI; omit for connection directory where optional. Reuse escaped filenames verbatim.",
	fallback_encoding: "Directory fallback for undecodable files; never overrides BOM or valid UTF-8.",
	filter_mode: "ignore respects .ignore only; all disables filtering. Both include hidden/.git files; neither reads Git ignores.",
	output_mode: "Select the output shape; grep defaults to files_with_matches, glob to paths. Grep summary ignores paging.",
	head_limit: "Maximum output entries; 0 removes this limit, not the token budget.",
	timeout_ms: "Command process-tree timeout in milliseconds, max 240000.",
	cwd: "Absolute working directory; omit for the FastCtx connection directory (not the calling session).",
	encoding: "Source encoding label (e.g. gbk); omit for detection. Output is UTF-8.",
	files: "Prefer batches: 1-32 text ranges, in order; exclusive with file_path and top-level offset/encoding/pages/pdf_mode/view. Top-level limit is a default.",
	offset: "Continuation offset; use the returned paging marker.",
	limit: "Maximum results/lines; read batch entries override the top-level default.",
	pages: "PDF page range, e.g. 1-5; max 20 pages. Required for text PDFs over 10 pages.",
	pdf_mode: "PDF text layer only; rendered images are unsupported.",
	view: "auto selects text/PDF; hex inspects raw bytes of any file.",
	glob: "Prefer glob[] batches; ! excludes paths.",
	context: "Content mode: lines before and after each match.",
	job_id: "ID returned by your own run_background in this session.",
	wait_ms: "Wait milliseconds, max 240000; default 30000.",
	after_seq: "Output sequence cursor; omit to use this connection's cursor.",
	command: "Bash command, not PowerShell syntax.",
	login_shell: "Use bash login shell; default true."
};
function shorten(schema, field, tool) {
	if (Array.isArray(schema)) return schema.map((value) => shorten(value, field, tool));
	if (!schema || typeof schema !== "object") return schema;
	const result = {};
	for (const [key, value] of Object.entries(schema)) if (key === "description") result[key] = field === "pattern" ? tool === "grep" || tool === "replace" ? "Rust regex; escape literal braces. One pattern per call." : "Prefer pattern[] batches; ! excludes paths." : field === "offset" ? tool === "inspect_local_file" ? "Start at this 1-based line; use for continuation." : "Skip this many results (0-based); use for continuation." : field === "encoding" && tool === "grep" ? "Single-file encoding label (e.g. gbk); directories use fallback_encoding." : FIELDS[field] ?? String(value).replace(/\s+/g, " ").trim();
	else if (key === "properties") result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, shorten(child, name, tool)]));
	else result[key] = shorten(value, field, tool);
	return result;
}
function projectTool(tool) {
	const inputSchema = shorten(tool.inputSchema ?? {
		type: "object",
		properties: {}
	}, "", tool.name);
	if (tool.name === "grep") {
		delete inputSchema.properties?.before_context;
		delete inputSchema.properties?.after_context;
	}
	if (tool.name === "inspect_local_file" && inputSchema.properties?.pdf_mode) inputSchema.properties.pdf_mode.enum = ["text"];
	return {
		...tool,
		description: DESCRIPTIONS[tool.name] ?? tool.description ?? "",
		inputSchema
	};
}
//#endregion
//#region src/ops/runtime-pool.js
/** One plugin-owned FastCtx connection shared by independently toggled components. */
const pools = /* @__PURE__ */ new WeakMap();
async function acquireRuntime(ctx, runtime, env) {
	const root = ctx.root;
	let pool = pools.get(root);
	if (!pool) {
		pool = {
			clients: /* @__PURE__ */ new Map(),
			closing: Promise.resolve()
		};
		pools.set(root, pool);
	}
	await pool.closing;
	const key = JSON.stringify([runtime.file, env.FASTCTX_BASH]);
	let entry = pool.clients.get(key);
	if (!entry) {
		const client = McpStdioClient.start({
			file: runtime.file,
			args: ["serve", "--enable-shell"],
			env,
			timeoutMs: 6e4
		});
		entry = {
			client,
			refs: 0,
			ready: void 0
		};
		pool.clients.set(key, entry);
		entry.ready = (async () => {
			try {
				const handshake = await client.initialize("dsh-ops-components");
				const tools = await client.listTools();
				return {
					client,
					handshake,
					tools
				};
			} catch (error) {
				if (pool.clients.get(key) === entry) pool.clients.delete(key);
				await client.close();
				throw error;
			}
		})();
		client.exited.then(() => {
			if (pool.clients.get(key) === entry) pool.clients.delete(key);
		});
	}
	entry.refs += 1;
	let released = false;
	const release = async () => {
		if (released) return;
		released = true;
		entry.refs -= 1;
		if (!entry.refs) {
			if (pool.clients.get(key) === entry) pool.clients.delete(key);
			const closing = pool.closing.then(() => entry.client.close());
			pool.closing = closing.catch(() => {});
			await closing;
		}
	};
	try {
		return {
			...await entry.ready,
			release
		};
	} catch (error) {
		await release();
		throw error;
	}
}
//#endregion
//#region src/ops/tools.js
/**
* The FastCtx tool surface: this plugin's own long-lived MCP stdio connection
* to the vendored FastCtx server, and the `ops_<rawName>` tool definitions it
* publishes into the harness tool registry.
*
* The boundary held here is deliberate, because breaking it already shipped
* once: **the plugin registers its own tools through its own context and never
* rewrites the shared tool registry.** Replacing `ToolRuntime.register` made
* every *foreign* registration look like this plugin's own — a Cordis service
* property read returns a wrapper bound to the reading context, so the
* patched call attributed the caller's write to this plugin — and the host's
* second registration of a name such as `subagent` then threw "already
* registered", failing every new session. See the plugin's `AGENTS.md`,
* "上游兼容 (upstream compatibility)".
*
* Load-time semantics are the caller's: an unavailable server is fatal only
* when the deployment says `required: true`.
*
* @module dsh-ops/tools
*/
/** Deadline for one connection attempt: spawn, initialize, and `tools/list`. */
const CONNECT_TIMEOUT_MS = 6e4;
/**
* Reconnect policy. One outage shares one attempt budget: `maxAttempts`
* consecutive failed attempts, delays doubling from `initialDelayMs` up to
* `maxDelayMs`. A connection that stayed up at least `maxDelayMs` closes the
* outage, so the next disconnect starts a fresh budget while a crash-looping
* server — even one whose connects briefly succeed — still exhausts the cap
* instead of restarting forever.
*/
const RECONNECT = Object.freeze({
	initialDelayMs: 500,
	maxDelayMs: 3e4,
	maxAttempts: 10
});
/** Credential-shaped environment names the harness never forwards to a child. */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
/** The harness's own fact prefix, never forwarded to a child implicitly. */
const DSH_ENV_PREFIX = "DSH_";
/**
* The canonical value schema of one published tool: the MCP content array,
* plus the server's structured result when it sends one. `structuredContent`
* is declared but not required, so a result without one is still canonical.
*/
const OUTPUT_SCHEMA = Object.freeze({
	type: "object",
	properties: {
		content: {
			type: "array",
			items: {}
		},
		structuredContent: {}
	},
	required: ["content"],
	additionalProperties: false
});
/** Raised internally when `stop()` wins the race against an in-flight connect. */
var StoppedError = class extends Error {
	constructor() {
		super("the FastCtx tool surface was stopped");
		this.name = "StoppedError";
	}
};
/**
* Describe one thrown value for a report line.
* @param {unknown} error - the thrown value.
* @returns {string} the message.
*/
function messageOf(error) {
	return String(
		/** @type {{message?: unknown}} */
		error?.message ?? error
	);
}
/**
* The environment one FastCtx child starts from.
*
* The harness never forwards credential-shaped names or its own `DSH_*` facts
* to a child, and the MCP bridge this plugin used to mount applied that same
* scrub. The plugin spawns the server itself now, so it keeps the guarantee:
* `PATH`, `HOME`, locale, and proxy variables survive so child tooling runs
* normally, while credentials are never inherited implicitly (`gh` and `git`
* keep reading their own configuration files).
* @param {NodeJS.ProcessEnv} [parent] - the environment to scrub.
* @returns {NodeJS.ProcessEnv} a fresh environment object safe to hand to a spawn.
*/
function childEnv(parent = process.env) {
	const env = {};
	for (const [key, value] of Object.entries(parent)) {
		if (value === void 0) continue;
		if (SENSITIVE_ENV_PATTERN.test(key)) continue;
		if (key.toUpperCase().startsWith(DSH_ENV_PREFIX)) continue;
		env[key] = value;
	}
	return env;
}
/**
* The FastCtx command line this deployment wants: the shell tools are opt-in.
* @param {boolean} enableShellTools - whether to publish FastCtx's run/job tools.
* @returns {string[]} the server arguments.
*/
function serverArgs(enableShellTools) {
	return enableShellTools ? ["serve", "--enable-shell"] : ["serve"];
}
/**
* Project one MCP content array into the text the model reads.
*
* Text blocks are joined verbatim. Blocks this plugin cannot present as model
* context (images, audio, embedded resources) become one explicit placeholder
* rather than silence, and the raw MCP content stays in the canonical value for
* programmatic callers.
* @param {unknown[]} content - the MCP content array.
* @param {string} rawName - the server's own tool name, for the empty case.
* @returns {string} the rendered text.
*/
function renderContent(content, rawName) {
	const parts = [];
	for (const value of content) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			parts.push("[unsupported MCP content block: expected an object]");
			continue;
		}
		const block = value;
		switch (block.type) {
			case "text":
				if (typeof block.text === "string") parts.push(block.text);
				break;
			case "resource_link":
				parts.push(typeof block.name === "string" && typeof block.uri === "string" ? `Resource link: ${block.name} (${block.uri})` : "[resource link unavailable: the MCP block is missing its name or URI]");
				break;
			case "image":
			case "audio":
			case "resource":
				parts.push(`[${block.type} content is not shown to the model; the raw MCP result remains available to programmatic callers]`);
				break;
			default: parts.push(`[unsupported MCP content type: ${String(block.type)}]`);
		}
	}
	const text = parts.join("\n");
	return text === "" ? `(${publicToolName(rawName)} returned no model-visible content)` : text;
}
/**
* Map one MCP `tools/call` result onto the harness tool-result contract.
*
* An MCP error result becomes a rejected call, exactly as the bridge did
* before: the model must read the error and correct its arguments instead of
* treating an empty success as an answer.
* @param {unknown} result - the raw MCP result.
* @param {string} rawName - the server's own tool name.
* @returns {{content: unknown[], structuredContent?: unknown}} the canonical value.
* @throws {Error} when the result is malformed, or when it is an error result.
*/
function toToolValue(result, rawName) {
	const value = result;
	if (typeof value !== "object" || value === null || !Array.isArray(value.content)) throw new Error(`${publicToolName(rawName)} returned an invalid MCP result without a content array`);
	if (value.isError === true) throw new Error(renderContent(value.content, rawName));
	return {
		content: value.content,
		...value.structuredContent !== void 0 ? { structuredContent: value.structuredContent } : {}
	};
}
/**
* Refuse arguments the tool's own published schema does not declare.
*
* A tool registered through the host's raw `ctx.tools.register()` path is not
* argument-checked: only `defineTool` wraps its body with `validate(args)`, and
* the registry dispatches straight to `execute`. Reading a known field with
* `args?.job_id` therefore drops an undeclared key in silence, and the plugin
* has to be strict about its own surface — `ops_bash` already is, through
* `assertKnownArguments` in `shells.js`.
*
* The background tools were the gap. Their ownership check read
* `args?.job_id` before the server saw the call, so a mistyped key (`id`
* instead of `job_id`) and a missing one both produced "This job was not
* started by this session on the current connection." — a true statement about
* a job ID that was never read, and the wrong direction to send a caller.
*
* The declared names come from FastCtx's own published schema rather than a
* local copy, so a new upstream parameter cannot be refused here. These
* requests parse with `serde(deny_unknown_fields)`, so the advertised
* properties are exactly the accepted ones. A tool without a published object
* schema is passed through unchecked: the server still owns its own strictness.
* @param {string} rawName - the server's own tool name.
* @param {unknown} args - the model arguments.
* @param {readonly {name?: string, inputSchema?: {properties?: unknown, required?: unknown}}[]} tools - the server's own tools.
* @returns {void}
* @throws {Error} when an argument is undeclared, or a required one is absent.
*/
function assertDeclaredArguments(rawName, args, tools) {
	const schema = tools.find((tool) => tool?.name === rawName)?.inputSchema;
	const properties = schema?.properties;
	if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return;
	if (args !== void 0 && args !== null && (typeof args !== "object" || Array.isArray(args))) throw new Error(`invalid arguments: expected an object, got ${JSON.stringify(args)}`);
	const provided = args ?? {};
	const known = Object.keys(properties);
	const unknown = Object.keys(provided).filter((key) => !known.includes(key));
	if (unknown.length > 0) {
		const names = unknown.map((key) => JSON.stringify(key)).join(", ");
		throw new Error(`invalid arguments: unknown ${unknown.length === 1 ? "key" : "keys"} ${names}; this tool accepts ${known.join(", ")}`);
	}
	const missing = (Array.isArray(schema.required) ? schema.required : []).filter((key) => known.includes(key) && provided[key] === void 0);
	if (missing.length > 0) {
		const names = missing.map((key) => JSON.stringify(key)).join(", ");
		throw new Error(`invalid arguments: missing required ${missing.length === 1 ? "field" : "fields"} ${names}`);
	}
}
/**
* One registered tool definition for one FastCtx tool.
* @param {object} options - the definition inputs.
* @param {{name: string, description?: string, inputSchema?: Record<string, unknown>}} options.tool - the server's own tool.
* @param {(args: Record<string, unknown>, exec: unknown) => Promise<{content: unknown[], structuredContent?: unknown}>} options.call - the call body.
* @returns {object} the definition `ctx.tools.register()` accepts.
*/
function toolDefinition({ tool, call }) {
	tool = projectTool(tool);
	return {
		name: publicToolName(tool.name),
		description: tool.description ?? "",
		...[
			"grep",
			"glob",
			"inspect_local_file"
		].includes(tool.name) ? { isConcurrencySafe: () => true } : {},
		parameters: tool.inputSchema ?? {
			type: "object",
			properties: {}
		},
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: renderContent(value.content ?? [], tool.name)
			}]
		},
		execute: (args, exec) => call(args, exec)
	};
}
/**
* One owned FastCtx connection and the tool generation it publishes.
*
* The surface needs exactly one thing from its context — the tool registry this
* plugin registers into — so that a caller can drive it without a host, and so
* that there is no seam through which it could reach anything it does not own.
*/
var FastCtxTools = class {
	/**
	* @param {object} options - the surface inputs.
	* @param {{tools: {register: (definition: object) => () => void}}} options.ctx - this plugin's own registration context.
	* @param {import('./config.js').ResolvedConfig} options.config - the resolved plugin configuration.
	* @param {{file: string, source: string, version: string}} options.runtime - the resolved FastCtx executable.
	* @param {(message: string, level?: string) => void} [options.report] - where asynchronous events are reported.
	* @param {boolean} [options.fileTools] - whether this surface publishes file tools.
	* @param {readonly string[]} [options.commandTools] - allowed command tool names.
	* @param {boolean} [options.shared] - whether this surface leases the shared runtime.
	*/
	constructor({ ctx, config, runtime, report, fileTools = true, commandTools = SHELL_TOOLS, shared = false }) {
		this.ctx = ctx;
		this.config = config;
		this.runtime = runtime;
		this.fileTools = fileTools;
		this.commandTools = commandTools;
		this.shared = shared;
		this.leases = /* @__PURE__ */ new Map();
		this.pendingCalls = /* @__PURE__ */ new Set();
		this.shuttingDown = false;
		this.report = report ?? (() => {});
		/** The live connection, or undefined while the surface is down. */
		this.client = void 0;
		/** When the current connection was established; drives the stability rule. */
		this.connectedAt = void 0;
		/** Consecutive failed attempts inside the current outage. */
		this.attempts = 0;
		/** The pending reconnect timer, if any. */
		this.timer = void 0;
		/** Set once the owner disposed the surface; every later event is ignored. */
		this.stopped = false;
		/** Live registrations of the current generation, keyed by public name. */
		this.disposers = /* @__PURE__ */ new Map();
		/** The server's own identity, once a handshake succeeded. */
		this.serverInfo = void 0;
		/** The server's own instructions, as the model-facing section text. */
		this.serverInstructions = "";
		this.tools = [];
		this.agents = /* @__PURE__ */ new Map();
		this.ownedJobs = /* @__PURE__ */ new Map();
		this.bashAvailable = false;
		this.authorityAvailable = false;
	}
	/** Resolve the current session authority; no env or preset-label fallback. */
	shellAllowed(session) {
		if (!this.bashAvailable || !this.authorityAvailable || !this.config.enableShellTools || !session) return false;
		try {
			return this.ctx.get("sandboxPolicy")?.resolve({ session })?.mode === "danger-full-access";
		} catch {
			return false;
		}
	}
	/** Publish through a plugin-owned fiber, with the agent scope inherited. */
	attachAgent(agent) {
		if (this.stopped || !agent?.ctx || this.agents.has(agent)) return;
		const entry = {
			agent,
			ctx: void 0,
			fiber: void 0,
			disposers: []
		};
		this.agents.set(agent, entry);
		entry.fiber = agent.ctx.plugin((ctx) => {
			ctx.inject(["tools"], (toolsCtx) => {
				entry.ctx = toolsCtx;
				this.refreshAgents();
			});
		});
	}
	detachAgent(agent) {
		const entry = this.agents.get(agent);
		if (!entry) return;
		this.agents.delete(agent);
		for (const dispose of entry.disposers) dispose();
		entry.disposers = [];
		this.refreshAgents();
		return entry.fiber?.dispose();
	}
	/** Reconcile only this session's tool layer, without restarting FastCtx. */
	refreshAgent(agent) {
		const entry = this.agents.get(agent);
		if (!entry?.ctx) return;
		for (const dispose of entry.disposers) dispose();
		entry.disposers = [];
		if (this.stopped || this.shuttingDown) return;
		if (!this.shellAllowed(agent.session)) {
			const names = (this.ctx.get("tools")?.schemas(agent) ?? []).map((tool) => tool.name).filter((name) => SHELL_TOOLS.map(publicToolName).includes(name));
			if (names.length) try {
				entry.disposers.push(entry.ctx.tools.restrict({ deny: names }));
			} catch (error) {
				this.report(`dsh-ops: inherited command restriction failed: ${messageOf(error)}`, "warn");
			}
			return;
		}
		const commandTools = this.tools.filter((tool) => this.commandTools.includes(tool.name));
		if (commandTools.length !== this.commandTools.length) return;
		try {
			for (const tool of commandTools) entry.disposers.push(entry.ctx.tools.register(toolDefinition({
				tool,
				call: (args, exec) => this.#call(tool.name, args, exec)
			})));
		} catch (error) {
			for (const dispose of entry.disposers) dispose();
			entry.disposers = [];
			this.report(`dsh-ops: command publication failed: ${messageOf(error)}`, "warn");
		}
	}
	refreshAgents() {
		for (const entry of this.agents.values()) {
			for (const dispose of entry.disposers) dispose();
			entry.disposers = [];
		}
		for (const agent of this.agents.keys()) if (this.shellAllowed(agent.session)) this.refreshAgent(agent);
		for (const agent of this.agents.keys()) if (!this.shellAllowed(agent.session)) this.refreshAgent(agent);
	}
	/** The public names currently published, in registration order. */
	names() {
		return [...this.disposers.keys()];
	}
	/**
	* The hosted server's own instructions, already attributed to it.
	*
	* The MCP bridge used to publish these as a prompt section of its own; the
	* plugin keeps the same section name and text shape so the model still reads
	* the server's instructions. Empty while the server is down or sends none.
	* @returns {string} the section text.
	*/
	instructions() {
		return this.serverInstructions;
	}
	/**
	* Connect and publish the first generation of tools.
	* @returns {Promise<string[]>} the published public names; empty when the server listed none.
	* @throws {Error} on any connection failure — the caller decides whether that is fatal.
	*/
	async start() {
		await this.#connect();
		return this.names();
	}
	/**
	* Keep trying in the background after a failed `start()`, with bounded
	* exponential backoff, and republish the whole generation on success.
	* The caller picks this only for a deployment that tolerates a missing
	* server; a fatal one must let `start()` reject instead.
	* @returns {void}
	*/
	retryLater() {
		if (this.stopped || this.client !== void 0) return;
		this.#scheduleReconnect();
	}
	/**
	* Unregister every tool this surface published and stop the child process.
	*
	* Idempotent, and silent about work that was in flight when it was called.
	* @returns {Promise<void>} resolves once the child is gone.
	*/
	async stop() {
		this.shuttingDown = true;
		this.refreshAgents();
		await Promise.allSettled([...this.pendingCalls]);
		const cleanupClient = this.client;
		if (cleanupClient) for (const ids of this.ownedJobs.values()) for (const job_id of ids) try {
			if ((await cleanupClient.callTool("job_kill", { job_id }, { timeoutMs: 15e3 }))?.isError) this.report(`dsh-ops: owned job ${job_id} could not be stopped during component shutdown.`, "warn");
		} catch (error) {
			this.report(`dsh-ops: owned job ${job_id} shutdown failed: ${messageOf(error)}`, "warn");
		}
		this.stopped = true;
		if (this.timer !== void 0) {
			clearTimeout(this.timer);
			this.timer = void 0;
		}
		const client = this.client;
		this.client = void 0;
		this.connectedAt = void 0;
		this.serverInstructions = "";
		this.#unpublish();
		this.tools = [];
		this.ownedJobs.clear();
		await Promise.all([...this.agents.keys()].map((agent) => this.detachAgent(agent)));
		if (client !== void 0) await this.#release(client);
	}
	async #release(client) {
		const lease = this.leases.get(client);
		this.leases.delete(client);
		if (lease) await lease.release();
		else if (!this.shared) await client.close();
	}
	/**
	* Spawn one server, handshake, list its tools, and swap in the new generation.
	* @returns {Promise<void>} resolves once the generation is live.
	*/
	async #connect() {
		let lease;
		const env = childEnv();
		const bash = resolveShells(this.config).bash;
		this.bashAvailable = bash.available;
		env.FASTCTX_BASH = bash.available ? path.resolve(bash.file) : path.join(PACKAGE_ROOT, ".disabled-system-shell", "bash.exe");
		if (this.shared) {
			lease = await acquireRuntime(this.ctx, this.runtime, env);
			if (this.shuttingDown || this.stopped) {
				await lease.release();
				throw new StoppedError();
			}
			this.leases.set(lease.client, lease);
		}
		const client = lease?.client ?? McpStdioClient.start({
			file: this.runtime.file,
			args: serverArgs(this.config.enableShellTools),
			env,
			timeoutMs: CONNECT_TIMEOUT_MS
		});
		this.client = client;
		client.exited.then(({ code, signal, error }) => this.#onExit(client, code, signal, error));
		try {
			const handshake = lease?.handshake ?? await client.initialize("dsh-ops");
			const tools = lease?.tools ?? await client.listTools();
			if (this.stopped || this.shuttingDown || client !== this.client) throw new StoppedError();
			this.ownedJobs.clear();
			this.#publish(tools);
			this.serverInfo = handshake?.serverInfo;
			this.serverInstructions = "";
			this.connectedAt = Date.now();
		} catch (error) {
			await this.#release(client);
			if (this.client === client) this.client = void 0;
			throw error;
		}
	}
	/**
	* React to one connection ending: report it, then reconnect with backoff.
	* @param {McpStdioClient} client - the connection that ended.
	* @param {number|null} code - the exit code.
	* @param {string|null} signal - the terminating signal.
	* @param {Error} [error] - the spawn error, when the server never started.
	* @returns {void}
	*/
	#onExit(client, code, signal, error) {
		if (this.stopped || this.shuttingDown || client !== this.client) return;
		this.#release(client);
		this.client = void 0;
		this.ownedJobs.clear();
		this.tools = [];
		this.#unpublish();
		this.refreshAgents();
		this.connectedAt = void 0;
		this.report(`dsh-ops: ${this.#describe()} ${error !== void 0 ? `could not be started (${error.message})` : `exited (code ${code ?? "null"}, signal ${signal ?? "none"})`}; the published tools are withdrawn until it is back.`);
		this.#scheduleReconnect();
	}
	/**
	* Wait, then try once more, then either recover or spend another attempt.
	* @returns {void}
	*/
	#scheduleReconnect() {
		if (this.stopped || this.shuttingDown || this.timer !== void 0) return;
		if (this.connectedAt !== void 0 && Date.now() - this.connectedAt >= RECONNECT.maxDelayMs) this.attempts = 0;
		this.connectedAt = void 0;
		this.attempts += 1;
		if (this.attempts > RECONNECT.maxAttempts) {
			this.#unpublish();
			this.serverInstructions = "";
			this.report(`dsh-ops: giving up on FastCtx after ${RECONNECT.maxAttempts} consecutive failed reconnect attempts; the ops_ tools are unavailable until the plugin is reloaded.`);
			return;
		}
		const delayMs = Math.min(RECONNECT.maxDelayMs, RECONNECT.initialDelayMs * 2 ** (this.attempts - 1));
		this.report(`dsh-ops: FastCtx is down; reconnecting in ${delayMs}ms (attempt ${this.attempts}/${RECONNECT.maxAttempts}).`, "warn");
		this.timer = setTimeout(() => {
			this.timer = void 0;
			this.#reconnect();
		}, delayMs);
		this.timer.unref?.();
	}
	/**
	* One scheduled reconnect attempt: publish a fresh generation, or spend the
	* next attempt. Never rejects and never takes the plugin down.
	* @returns {Promise<void>} resolves once this attempt settled.
	*/
	async #reconnect() {
		if (this.stopped || this.shuttingDown) return;
		try {
			await this.#connect();
			this.report(`dsh-ops: ${this.#describe()} reconnected with ${this.names().length} tool(s).`);
		} catch (error) {
			if (this.stopped || this.shuttingDown) return;
			this.report(`dsh-ops: FastCtx reconnect attempt ${this.attempts}/${RECONNECT.maxAttempts} failed (${messageOf(error)}).`, "warn");
			this.#scheduleReconnect();
		}
	}
	/**
	* Publish one whole generation, or leave the previous one untouched.
	*
	* The next generation is built completely before the live one is disposed, so
	* a failed `tools/list` or a malformed definition costs nothing. A failure
	* while registering rolls the partial generation back and surfaces as a
	* connection failure: a registry conflict can only mean a foreign
	* registration squats on this plugin's own `ops_` names.
	* @param {{name: string, description?: string, inputSchema?: Record<string, unknown>}[]} tools - the server's tool list.
	* @returns {void}
	*/
	#publish(tools) {
		const definitions = [];
		const seen = /* @__PURE__ */ new Set();
		for (const tool of tools) {
			const name = publicToolName(String(tool?.name ?? ""));
			if (seen.has(name)) throw new Error(`${this.#describe()} listed the tool "${String(tool?.name)}" more than once`);
			seen.add(name);
			if (!this.fileTools || !FILE_TOOLS.includes(tool.name)) continue;
			definitions.push(toolDefinition({
				tool,
				call: (args, exec) => this.#call(tool.name, args, exec)
			}));
		}
		this.#unpublish();
		const disposers = /* @__PURE__ */ new Map();
		try {
			for (const definition of definitions) disposers.set(definition.name, this.ctx.tools.register(definition));
		} catch (error) {
			for (const dispose of disposers.values()) dispose();
			throw error;
		}
		this.disposers = disposers;
		this.tools = tools;
		this.refreshAgents();
	}
	/** Release every registration of the current generation. @returns {void} */
	#unpublish() {
		for (const dispose of this.disposers.values()) dispose();
		this.disposers = /* @__PURE__ */ new Map();
	}
	/**
	* Call one FastCtx tool and map its result onto the host contract.
	* @param {string} rawName - the server's own tool name.
	* @param {Record<string, unknown>} args - the arguments.
	* @param {{signal?: AbortSignal, agent?: {session?: object}}} [exec] - the host execution context.
	* @returns {Promise<{content: unknown[], structuredContent?: unknown}>} the canonical value.
	*/
	#call(rawName, args, exec) {
		if (this.shuttingDown || this.stopped) return Promise.reject(/* @__PURE__ */ new Error("This dsh-ops component is shutting down."));
		const call = this.#callActive(rawName, args, exec);
		this.pendingCalls.add(call);
		call.then(() => this.pendingCalls.delete(call), () => this.pendingCalls.delete(call));
		return call;
	}
	async #callActive(rawName, args, exec) {
		const label = publicToolName(rawName);
		const session = exec?.agent?.session;
		if (SHELL_TOOLS.includes(rawName) && !this.shellAllowed(session)) throw new Error("Command and job tools require authoritative danger-full-access for this session.");
		if (rawName === "inspect_local_file") {
			if (args?.pdf_mode === "image") throw new Error("PDF images are unsupported; use PDF text mode or host read_image for an image file.");
			const paths = args?.files?.map?.((entry) => entry?.path) ?? [args?.file_path];
			if (args?.view !== "hex" && paths.some((path) => /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(String(path ?? "")))) throw new Error("This is an image; use host read_image.");
		}
		if (rawName === "run_background") args = {
			...args,
			cwd: args?.cwd ?? session?.header?.cwd
		};
		const client = this.client;
		if (client === void 0) throw new Error(`${label} is unavailable: the FastCtx server is not connected (reconnect attempt ${this.attempts}/${RECONNECT.maxAttempts} in progress; retry shortly)`);
		if (BACKGROUND_TOOLS.includes(rawName)) assertDeclaredArguments(rawName, args, this.tools);
		let owned = this.ownedJobs.get(session) ?? /* @__PURE__ */ new Set();
		if ((rawName === "job_output" || rawName === "job_kill") && !owned.has(args?.job_id)) throw new Error("This job was not started by this session on the current connection.");
		if (rawName === "job_list") return this.#listOwnedJobs(client, session, owned, args, exec);
		let result;
		try {
			result = await client.callTool(rawName, args ?? {}, {
				timeoutMs: this.config.toolCallTimeoutMs,
				signal: exec?.signal
			});
		} catch (error) {
			throw new Error(`${label} failed: ${messageOf(error)}`, { cause: error });
		}
		let value = toToolValue(result, rawName);
		if (rawName === "inspect_local_file" && value.content.some((block) => block?.type === "image")) throw new Error("This result contains an image; use host read_image. For PDFs, request the text layer.");
		if (client !== this.client || this.stopped) throw new Error("FastCtx connection changed; retry on the current connection.");
		if (rawName === "run_background") {
			const id = startedJob(value);
			if (!id) throw new Error("The background launch did not return a recognized job ID; it cannot be managed by this session.");
			owned = this.ownedJobs.get(session) ?? owned;
			owned.add(id);
			this.ownedJobs.set(session, owned);
		}
		value = cleanBackground(value, owned);
		return value;
	}
	/** Aggregate upstream pages privately; do not expose global counts/offsets. */
	async #listOwnedJobs(client, session, owned, args, exec) {
		const limit = args?.limit ?? 20;
		const offset = args?.offset ?? 0;
		const status = args?.status ?? "running";
		if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || ![
			"running",
			"finished",
			"all"
		].includes(status)) throw new Error("Invalid job list parameters: limit 1..100, offset >= 0, status running/finished/all.");
		if (!owned.size) return { content: [{
			type: "text",
			text: "(Complete: no owned jobs.)"
		}] };
		const selected = /* @__PURE__ */ new Map();
		let cursor = 0;
		let complete = false;
		const deadline = Date.now() + this.config.toolCallTimeoutMs;
		for (let page = 0; page < 100 && Date.now() < deadline; page += 1) {
			if (client !== this.client || !this.shellAllowed(session)) throw new Error("Connection or permission changed during job listing.");
			const parsed = jobEntries(toToolValue(await client.callTool("job_list", {
				...args,
				status,
				limit: 100,
				offset: cursor
			}, {
				timeoutMs: Math.max(1, deadline - Date.now()),
				signal: exec?.signal
			}), "job_list"));
			for (const entry of parsed.entries) if (owned.has(entry.id)) selected.set(entry.id, entry);
			if (!parsed.partial) {
				complete = true;
				break;
			}
			const next = parsed.next ?? cursor + parsed.entries.length;
			if (next <= cursor) break;
			cursor = next;
		}
		if (client !== this.client || !this.shellAllowed(session)) throw new Error("Connection or permission changed during job listing.");
		const entries = [...selected.values()];
		const shown = entries.slice(offset, offset + limit);
		const marker = offset + shown.length < entries.length ? `(Partial: more owned jobs; offset=${offset + shown.length}.)` : complete ? `(Complete: ${entries.length} owned jobs.)` : "(Partial: owned job inventory scan limit reached; use known job IDs.)";
		return { content: [{
			type: "text",
			text: [...shown.map((entry) => entry.text), marker].join("\n\n")
		}] };
	}
	/**
	* The runtime identity used in reports.
	* @returns {string} a human-readable description.
	*/
	#describe() {
		return `FastCtx ${this.runtime.version || "unknown version"} (${this.runtime.source})`;
	}
};
//#endregion
export { FastCtxTools };

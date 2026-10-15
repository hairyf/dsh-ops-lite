import { C as PACKAGE_NAME } from "./workspace-preparation-D85l4ytv.js";
import { t as applyComponent } from "./ops-BZZPSs4k.js";
import process from "node:process";
//#region src/background.ts
const name = `${PACKAGE_NAME}/background`;
const inject = [
	"tools",
	"sandboxPolicy",
	"subprocess"
];
function apply(ctx) {
	applyComponent(ctx, {
		required: true,
		allowSystemShellFallback: process.platform !== "win32"
	}, "background");
}
//#endregion
export { apply, inject, name };

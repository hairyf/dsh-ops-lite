import { C as PACKAGE_NAME } from "./workspace-preparation-Bi50pwsN.js";
import { t as applyComponent } from "./ops-CqGYpXQY.js";
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

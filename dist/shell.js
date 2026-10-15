import { C as PACKAGE_NAME } from "./workspace-preparation-D0pi029l.js";
import { t as applyComponent } from "./ops-q0FFS0iN.js";
import process from "node:process";
//#region src/shell.ts
const name = `${PACKAGE_NAME}/shell`;
const inject = [
	"tools",
	"sandboxPolicy",
	"subprocess"
];
function apply(ctx) {
	applyComponent(ctx, {
		required: true,
		allowSystemShellFallback: process.platform !== "win32"
	}, "shell");
}
//#endregion
export { apply, inject, name };

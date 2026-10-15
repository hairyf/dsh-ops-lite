import { C as PACKAGE_NAME } from "./workspace-preparation-BurRV1lU.js";
import { t as applyComponent } from "./ops-C700ahzC.js";
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

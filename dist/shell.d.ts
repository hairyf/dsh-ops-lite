import { Context } from "@deepseek-ai/cordis";
//#region src/shell.d.ts
declare const name = "dsh-ops-lite/shell";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };
import { Context } from "@deepseek-ai/cordis";
//#region src/ptc.d.ts
declare const name = "dsh-ops-lite/ptc";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };
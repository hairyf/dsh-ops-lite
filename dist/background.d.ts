import { Context } from "@deepseek-ai/cordis";
//#region src/background.d.ts
declare const name = "dsh-ops-lite/background";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };
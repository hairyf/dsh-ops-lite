import Schema from "@deepseek-ai/schemastery";
import { Context, Volatile } from "@deepseek-ai/cordis";
//#region src/types.d.ts
type RuntimeMode = 'local-first' | 'managed';
interface OpsConfig {
  enableShell: boolean;
  enableFile: boolean;
  enableBackground: boolean;
  enablePtc: boolean;
  disableOfficialTools: boolean;
  runtimeMode: RuntimeMode;
  allowLocalRuntimes: boolean;
  bashPath: string;
  pwshPath: string;
  fastctxPath: string;
  workerPath: string;
  promptPolicy: boolean;
  publishBashTool: boolean;
  enableShellTools: boolean;
  required: boolean;
  toolCallTimeoutMs: number;
  extraGuidance: string;
}
type OpsConfigRef = Volatile<OpsConfig>;
//#endregion
//#region src/config.d.ts
declare const Config: Schema<NoInfer<Schemastery.ObjectS<NoInfer<{
  enableShell: Schema<boolean, boolean, "defined">;
  enableFile: Schema<boolean, boolean, "defined">;
  enableBackground: Schema<boolean, boolean, "defined">;
  enablePtc: Schema<boolean, boolean, "defined">;
  disableOfficialTools: Schema<boolean, boolean, "defined">;
  runtimeMode: Schema<"local-first" | "managed", "local-first" | "managed", "defined">;
  allowLocalRuntimes: Schema<boolean, boolean, "defined">;
  bashPath: Schema<string, string, "defined">;
  pwshPath: Schema<string, string, "defined">;
  fastctxPath: Schema<string, string, "defined">;
  workerPath: Schema<string, string, "defined">;
  promptPolicy: Schema<boolean, boolean, "defined">;
  publishBashTool: Schema<boolean, boolean, "defined">;
  enableShellTools: Schema<boolean, boolean, "defined">;
  required: Schema<boolean, boolean, "defined">;
  toolCallTimeoutMs: Schema<number, number, "defined">;
  extraGuidance: Schema<string, string, "defined">;
}>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
  enableShell: Schema<boolean, boolean, "defined">;
  enableFile: Schema<boolean, boolean, "defined">;
  enableBackground: Schema<boolean, boolean, "defined">;
  enablePtc: Schema<boolean, boolean, "defined">;
  disableOfficialTools: Schema<boolean, boolean, "defined">;
  runtimeMode: Schema<"local-first" | "managed", "local-first" | "managed", "defined">;
  allowLocalRuntimes: Schema<boolean, boolean, "defined">;
  bashPath: Schema<string, string, "defined">;
  pwshPath: Schema<string, string, "defined">;
  fastctxPath: Schema<string, string, "defined">;
  workerPath: Schema<string, string, "defined">;
  promptPolicy: Schema<boolean, boolean, "defined">;
  publishBashTool: Schema<boolean, boolean, "defined">;
  enableShellTools: Schema<boolean, boolean, "defined">;
  required: Schema<boolean, boolean, "defined">;
  toolCallTimeoutMs: Schema<number, number, "defined">;
  extraGuidance: Schema<string, string, "defined">;
}>>>, "volatile-defined">;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-ops-next";
declare const inject: string[];
/** Rebuild only our owned capability fiber after one atomic settings commit. */
declare function apply(ctx: Context, config: OpsConfigRef): Promise<void>;
//#endregion
export { Config, apply, inject, name };
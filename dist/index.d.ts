import Schema from "@deepseek-ai/schemastery";
import { Context, Volatile } from "@deepseek-ai/cordis";
//#region src/types.d.ts
interface OpsConfig {
  disableOfficialTools: boolean;
}
type OpsConfigRef = Volatile<OpsConfig>;
//#endregion
//#region src/config.d.ts
declare const Config: Schema<NoInfer<Schemastery.ObjectS<NoInfer<{
  disableOfficialTools: Schema<boolean, boolean, "defined">;
}>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
  disableOfficialTools: Schema<boolean, boolean, "defined">;
}>>>, "volatile-defined">;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-ops-lite";
declare const inject: string[];
/** The bundle mounts each capability from its independently owned loader row. */
declare function apply(ctx: Context, config: OpsConfigRef): Promise<void>;
//#endregion
export { Config, apply, inject, name };
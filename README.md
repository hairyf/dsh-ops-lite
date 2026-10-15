# dsh-ops-next

基于 [starter-plugin](https://github.com/dsh-tauri/starter-plugin) 维护的 [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) fork，为 DeepSeek Harness 提供原生文件操作、Bash、后台任务和 PTC 工具。

## 功能

普通会话启用后，无需先保存配置，即提供上游五个基础工具：

| 工具 | 用途 |
| --- | --- |
| `ops_bash` | 通过宿主进程服务执行 Bash，遵守会话权限与沙箱 |
| `ops_glob` | 原生文件匹配、分页与排序 |
| `ops_grep` | 原生文本搜索、上下文与分页 |
| `ops_inspect_local_file` | 有界文本或十六进制读取 |
| `ops_replace` | 带修订检查的确定性原子替换 |

同时保留上游能力：完全权限会话中的 `ops_run_background`、`ops_job_output`、`ops_job_list`、`ops_job_kill`，以及宿主确认的 PTC-only 会话中的 `ops_batch`、`ops_result`。Windows 保留 PowerShell 7 对宿主执行器的可撤销运行时覆盖。

缺少匹配平台的原生运行时属于安装或构建错误，会明确报错；不会悄悄只加载一部分工具。文件工具不提供新建文件写入器，`read_image` 仍由宿主负责。

## 设置

仅提供一个默认关闭的选项：**禁用官方基础工具**。设置页参考 [dsh-tool-activator](https://github.com/hairyf/dsh-tool-activator)，使用官方配置插槽与 SettingsForm 保存、撤销草稿；不再提供组件、运行时信任或 CLI 准备面板。

开启后拒绝 `read`、`write`、`edit`、`glob`、`grep`、`bash`、`pwsh`、`pwsh_persistent`，并隐藏公开 SDK 能限制的继承工具。保留 `read_image`、审批、提问和插件管理。SDK `0.2.1-alpha.1` 无法隐藏 agent 自己注册的 schema，这类工具仍可能显示，但全局 `tools.guard` 会拒绝执行。关闭选项后恢复；它不改变沙箱权限。Windows 覆盖后的宿主 PowerShell 仍名为 `pwsh`，因此也受此选项限制。

## 从源码构建

```bash
git clone --recurse-submodules https://github.com/hairyf/dsh-ops-next.git
cd dsh-ops-next
pnpm install --frozen-lockfile
pnpm build
```

需要 Node.js 22.19+ 或 24+、Rust 1.88+；Windows 还需要 MSVC C++ Build Tools 与 Windows SDK。`pnpm build` 和 `pnpm dev` 分别直接运行 `tsdown`、`tsdown --watch`；原生 worker、FastCtx、平台资源与 Windows Bash IPC 由 [tsdown 配置](<tsdown.config.ts>) 一并构建，不需要额外的运行时准备命令。

Windows 构建使用固定版本、校验摘要的 PortableGit 与 PowerShell 7；Unix 使用系统 Bash。构建可能下载固定的运行时、Cargo 依赖和 Pdfium，缓存仅保存在构建目录。安装后的工具调用不会下载软件，不修改系统 PATH，也不会覆盖本机 Git 的 DLL。

构建成功后运行 `pnpm pack`，在 Harness 的插件管理中安装对应平台的包。本仓库没有自动 npm 发布流程；不同平台的原生产物不能混用。

## 开发

```bash
pnpm dev
pnpm lint --fix
pnpm typecheck
pnpm test -- --run
cargo test --locked --manifest-path native/Cargo.toml
pnpm test:e2e
```

E2E 使用独立安装的真实 DSH、独立 home/profile/workspace 和随机端口；验证未配置时五个工具的真实调用、后台任务、PTC、沙箱边界及官方工具禁用/恢复。不会连接用户当前 GUI、修改 core renderer 或调用 LLM。

[CI](https://github.com/hairyf/dsh-ops-next/actions/workflows/ci.yml) 在 Windows/macOS/Linux 运行原生构建与真实 Harness + Playwright **L2**，参考 [deepseek-harness-desktop](https://github.com/dsh-tauri/deepseek-harness-desktop)。这是插件 E2E，不是三平台 Tauri WebDriver L3；通过状态以交付提交对应的完整 run 为准。安装体积与检查记录见[验证记录](<docs/validation.md>)。

## 上游与维护

- 上游：[T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops)，对照提交 `6e133320b4f7a81c289e05ff6afddc740cdef36e`。
- [`source/dsh-ops`](<source/dsh-ops>) 保留为固定 Git 子模块，用于比对；实际维护源码位于 [`src/ops`](<src/ops>)、[`native`](<native>) 和 [`vendor/fastctx`](<vendor/fastctx>)，不是构建时复制到 `dist/upstream` 的包装。
- 保留上游工具协议、修订与原子写入校验、会话作用域及沙箱边界。受限进程缺少约束提供者时明确拒绝，不退回裸进程；原生文件工具沿用固定的 `trusted-native-file-operations` 边界。
- [#37](https://github.com/T-Auto/dsh-ops/issues/37) 的体积优化必须建立在完整工具能力上，不能通过默认关闭功能、跳过原生资源或增加授权门槛制造“小包”。旧的不完整包体积不代表本次完整 fork。

## License

插件与原生核心：[MIT](<LICENSE.md>)；FastCtx：[Apache-2.0](<vendor/fastctx/LICENSE-APACHE>)，保留其 [NOTICE](<vendor/fastctx/NOTICE>) 与第三方许可。Git、PowerShell、Pdfium 遵循各自许可，构建产物保留相应说明。

> This product includes FastCtx
> (https://github.com/yc-duan/fastctx), Copyright (c) 2026 yc-duan,
> used under the Apache License 2.0.
>
> FastCtx is redistributed and/or modified here by the maintainer of
> this distribution. Any such change is that maintainer's own work
> and their sole responsibility. It is not endorsed by, not
> supported by, and not attributable to the author of FastCtx, who
> accepts no liability of any kind arising from this distribution or
> from anything built on top of it.

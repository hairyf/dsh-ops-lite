# dsh-ops-next

基于 [dsh-tauri/starter-plugin](https://github.com/dsh-tauri/starter-plugin) 的 DSH 运维工具插件，维护 [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops) 的文件、Shell、后台任务与 PTC 能力；修复 [上游 #37](https://github.com/T-Auto/dsh-ops/issues/37) 的默认安装体积与本机运行时复用问题。

上游固定为 [`source/dsh-ops`](<source/dsh-ops>) Git 子模块，提交 `6e133320b4f7a81c289e05ff6afddc740cdef36e`。构建时复制并应用小范围、严格匹配的补丁；不修改子模块、不重新实现上游工具协议。

## 能力与默认行为

| 组件 | 能力 | 默认 |
| --- | --- | --- |
| Shell | `ops_bash`，Windows 上通过原宿主 `pwsh` 执行器使用选定的 PowerShell 7 | 开启，但不会未经授权执行本机运行时 |
| 文件 | 原生 Rust worker：`ops_inspect_local_file`、`ops_grep`、`ops_glob`、`ops_replace` | 开启 |
| 后台任务 | FastCtx：`ops_run_background`、`ops_job_output`、`ops_job_list`、`ops_job_kill` | 关闭 |
| PTC | 原生 worker：`ops_batch`、`ops_result`，仅在宿主确认的 PTC-only 呈现中发布 | 关闭 |
| 诊断 | `ops_status` 返回启用状态、绝对路径、版本、来源、候选拒绝原因 | 始终提供 |

组件开关不是权限授权。保留上游会话作用域、文件 revision 检查、沙箱与审批：

- 本机 Bash 不替换成 ash，不把 WSL `bash.exe` 当作 Windows 本机 Bash；PowerShell 5.1 不兼容。
- 后台命令仅在会话完全权限下发布；PTC 不强制切换宿主呈现、不绕过可调用工具的权限。
- 受限 Shell 必须由宿主 `sandbox.confine` 成功约束；无可用约束时明确拒绝，不退回裸进程。
- 原生文件操作沿用 `trusted-native-file-operations` 固定操作边界，不把它宣称为通用进程沙箱。
- Windows 受限 Git Bash 还要求与实际 `msys-2.0.dll` 匹配的 IPC 代理及摘要证明。不匹配时拒绝；不会向用户 Git 安装目录硬链接或覆盖 DLL。

## 设置与本机运行时授权

设置页使用官方 `plugins.bundle.config` 插槽与原生 SettingsForm，布局参考 [dsh-tool-activator](https://github.com/hairyf/dsh-tool-activator)。在插件详情中选择组件、运行时来源及工具策略，修改先保留为草稿，点击“保存设置”后通过宿主 ConfigForms 原子提交并持久化。

默认 `runtimeMode: local-first`、`allowLocalRuntimes: false`。本机可执行文件必须获得明确授权；仅开启组件或打开页面不会触发下载。

- **授权本机优先**：显式绝对路径 → PATH 中逐个通过检查的候选 → 支持的标准安装位置 → 已有托管副本。显式路径不兼容或未授权时直接报原因，不悄悄改用其它安装。
- **仅托管模式**：排除本机路径与发现结果，保留上游 pin、SHA-256 和来源证明检查。文件 worker 默认使用交付包随附版本。
- 本机复用检查 Bash 身份/版本/`pipefail`、PowerShell 7、FastCtx 版本及真实 MCP 后台工具握手；它依赖用户对本机安装的信任，**不具备发行包固定摘要保证**。
- 托管 Shell 的上游固定下载目前只支持 Windows x64；Linux/macOS 请明确授权已安装的 Bash。PowerShell 覆盖仅适用于 Windows 的原宿主执行器。
- 关闭的组件不探测或安装其运行时。没有自动下载接口，不改系统 PATH，不修改其它插件的持久化配置；卸载插件不会删除本机安装。

### 禁用官方基础工具

可选开关默认关闭，拒绝执行 `read`、`write`、`edit`、`glob`、`grep`、`bash`、`pwsh`、`pwsh_persistent`，并隐藏能够通过公开 SDK 限制的继承工具。保留 `read_image`（Ops 没有图像替代）、审批、提问和插件管理。

SDK `0.2.1-alpha.1` 不能隐藏 agent 自己注册的 schema，这些工具仍可能显示，但会被公开的全局 `tools.guard` 拒绝执行；关闭开关后恢复。没有 patch 宿主方法或修改工具实现。请先确认替代组件可用：Ops 文件工具不提供新建文件写入器；Windows PowerShell 仍使用名为 `pwsh` 的宿主工具，因此此开关也会禁用它。

## 安装与显式准备

本仓库没有自动 npm 发布流程；创建仓库、CI 产物与 npm 发布是不同状态。下载对应平台的 CI 包，或从源码构建。包里的原生 worker 对应构建平台，不能把 Windows 的包当作 Linux/macOS 包使用。

```bash
git clone --recurse-submodules https://github.com/hairyf/dsh-ops-next.git
cd dsh-ops-next
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:native
```

需要 Node.js 22.19+ 或 24+、Rust 1.88+；CI 固定 Node.js 24.10.0 / Rust 1.98.1。Windows 原生编译还需要 MSVC C++ Build Tools 与 Windows SDK。SDK 兼容性以 `@deepseek-ai/dsh@0.2.1-alpha.1` 的实际 E2E 为准。

诊断不安装软件：

```bash
node dist/cli.js doctor
node dist/cli.js doctor --allow-local
node dist/cli.js doctor --allow-local --bash-path /absolute/path/to/bash
```

只有显式 `provision` 才准备缺少的运行时；只选择当前需要的组件，不必一次安装全部：

```bash
# 先看计划，不写入或下载
node dist/cli.js provision --fastctx --managed --dry-run
# FastCtx：从固定的上游 Rust 源码显式构建，写入管理目录并记录摘要
node dist/cli.js provision --fastctx --managed
# Windows x64：下载固定摘要的 PortableGit / PowerShell 7（分别按需执行）
node dist/cli.js provision --bash --managed
node dist/cli.js provision --pwsh --managed
```

CLI 的 `--allow-local` 只授权本次调用；设置页授权需单独保存。托管路径沿用上游 `<DSH_HOME>/dsh-ops/`（未设置时为 `~/.dsh/dsh-ops/`），不会改 PATH。FastCtx 显式源码构建需要 Rust，并可能下载 Cargo 依赖及上游固定摘要的 Pdfium；这不发生在插件安装或挂载期间。

### Windows 受限 Bash 的 IPC 代理

在安装或源码构建中显式选择匹配的 PortableGit/MSYS 根（含 `usr/bin/msys-2.0.dll`），再生成小型 IPC 代理。此命令只读选定的本机 DLL，输出到交付目录；不会修改该 Git 安装。

```bash
node scripts/build-bash-ipc.mjs --bash-root 'C:/absolute/PortableGit'
# 已完成全部构建后打包，避免 prepack 再次 clean 掉 IPC 产物
pnpm --config.ignore-scripts=true pack
```

代理与实际 MSYS 摘要必须匹配；更新 Git 后需要重新构建。普通 `pnpm pack` 的 prepack 会重建当前平台 worker，不会自动安装 Shell 或准备 IPC。`pnpm run build` 会清理 dist；完整打包顺序是 JS → native →（Windows 受限 Bash）IPC → pack。CI 产物保留实际构建目标与来源证明。

## #37 安装体积验证

已移除三个重量级 `optionalDependencies`；发布包无运行时 npm 依赖，无安装时下载脚本。保留小型原生文件/PTC worker、运行时选择逻辑和显式供应所需源码，不以牺牲沙箱换体积。

Windows x64 的隔离 npm 安装实测（2026-10-15，逐普通文件逻辑字节求和，**不是压缩下载大小或 NTFS 实际占用**）：

| 上游安装项 | 版本 | 字节 |
| --- | --- | ---: |
| `dsh-ops` 主包 | 0.3.0 | 6,000,575 |
| Bash payload | 0.2.1 | 411,141,701 |
| PowerShell payload | 0.2.1 | 256,628,393 |
| FastCtx payload | 0.2.1 | 49,935,052 |
| **上游默认安装合计** | | **723,705,721** |

新包的实际安装字节、被测 tarball 摘要和复现命令见[验证记录](<docs/validation.md>)。显式准备的可选运行时不计入“默认安装”，会另外占空间。

## 开发与验证

```bash
pnpm run lint --fix
pnpm run typecheck
pnpm run test -- --run
pnpm run build
pnpm run build:native
cargo test --locked --manifest-path .cache/native/Cargo.toml
pnpm run test:e2e
```

E2E 在系统临时目录独立安装固定版本的真实 DSH CLI，使用独立 home/profile/workspace 与随机端口，Chromium 操作设置并执行真实工具。不会连接用户当前 GUI、回退到既有 Harness、修改 core renderer 或调用 LLM。CI 包含 Windows/macOS/Linux 的原生编译、Rust 回归、真实 Harness + Playwright **L2**；这不是 Tauri WebDriver **L3**。参考 [desktop 的 CI](https://github.com/dsh-tauri/deepseek-harness-desktop)，不把其三平台 Rust tests 当作三平台桌面 GUI E2E。

## 上游维护

[`scripts/prepare-upstream.mjs`](<scripts/prepare-upstream.mjs>) 按精确文本打补丁，漂移时构建失败。当前改动限制为：外部传入已验证的 Shell、禁止旧迁移自动写回配置、跨平台 worker 目标、worker 卸载等待活动调用，以及可显式构建的 Windows IPC 源码入口。[`scripts/build-native.mjs`](<scripts/build-native.mjs>) 仅在暂存源码中修正 Unix 合法反斜杠文件名显示与原子替换的权限保留，不改文件安全边界。

升级子模块后重新运行所有检查及各平台 E2E；不要只更新 gitlink 或跳过来源校验。

## License

新插件及上游原生核心遵循 [MIT](<LICENSE.md>)；复用的 FastCtx 遵循 [Apache-2.0](<source/dsh-ops/vendor/fastctx/LICENSE-APACHE>)，并保留其 [NOTICE](<source/dsh-ops/vendor/fastctx/NOTICE>) 与第三方许可。构建包保留原有许可说明；本机或显式下载的 Git/PowerShell 运行时遵循各自许可。

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

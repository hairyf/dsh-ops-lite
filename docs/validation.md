# 验证记录

## 范围

交付必须先满足完整上游能力：普通会话无需保存配置，五个基础工具全部注册并真实执行；后台任务、PTC 与沙箱边界保持上游约束。四个组件保持独立配置行；文件组件仅新增默认开启、即时保存的禁用官方基础工具选项。源码实际维护于本仓库，构建由 tsdown 统一完成。

旧提交的 consent-first 分组配置与 `dist/upstream` 包装已经被替换。旧的 5,635,146 字节小包没有提供完整默认运行时，**不作为本次完整 fork 的体积或功能验收结果**。

## 上游安装基线

2026-10-15，Windows x64、Node v25.9.0，独立临时 home/cache 中真实执行 npm 安装。指标是包目录内普通文件逻辑字节之和，排除 npm cache、符号链接、锁文件、目录与 NTFS 分配开销，不是压缩下载大小。

| 上游安装项 | 版本 | 文件数 | 字节 |
| --- | --- | ---: | ---: |
| `dsh-ops` | 0.3.0 | 200 | 6,000,575 |
| `@dsh-ops/bash-win32-x64` | 0.2.1 | 9,614 | 411,141,701 |
| `@dsh-ops/pwsh-win32-x64` | 0.2.1 | 661 | 256,628,393 |
| `@dsh-ops/fastctx-win32-x64` | 0.2.1 | 10 | 49,935,052 |
| **默认安装合计** | | **10,485** | **723,705,721** |

## #37：安装期按需 Shell（当前方案）

2026-10-15T11:39:02.197Z，Windows x64、Node v25.9.0，真实隔离 npm 安装当前构建 tarball（禁用生命周期脚本，**不包含托管 Shell store**）：

| 基础安装项 | 版本 | 普通文件数 | 逻辑字节 |
| --- | --- | ---: | ---: |
| `dsh-ops-lite` | 0.1.1 | 30 | 337,097 |
| `@dshopslite/win32-x64` | 0.1.1 | 30 | 52,759,310 |
| **基础依赖图合计** | | **60** | **53,096,407** |

相同普通文件逻辑字节指标下，基础依赖图比上游完整默认安装少 **92.66%**。此数字不表示缺少 Shell 的机器运行完安装脚本后的总占用：若两项均需补齐，另有 Bash 载荷 411,680,937 字节和 PowerShell 载荷 257,167,805 字节，以及 npm / 托管目录元数据。已有兼容本地工具只记录来源，不重复下载。完整沙箱 Bash 仍可能创建原有的共享私有 IPC 副本；本次没有优化这份副本。

该快照主包压缩为 189,511 字节，SHA256 `4d3d88ffe90d03d28db480d38f0a6f003197b08de0a3d7dc360f4356a286e8cb`；Windows 平台包压缩为 25,905,277 字节，SHA256 `812eedf1b45c1b08f71fc1b275b78c5759bd8522cd87b0631ba6404f0e4741de`。后续源码、文档和元数据修正会改变归档字节，不宣称每次构建与此快照完全相同。

本地已通过：`pnpm run lint --fix`、`pnpm run typecheck`、`pnpm run test -- --run`（49 项）与 `pnpm run build`。Windows 隔离 E2E 从真实 tarball 安装主包 / 平台包，在仅监听 loopback 的测试注册表中验证安装脚本确实通过 npm 拉取两项载荷，再校验版本 / 来源 / hash，并验证离线修复无额外 HTTP；真实 Harness + Chromium L2 **1 项通过**。未向当前用户 Harness 安装，也未发布 npm。Linux / macOS 结果需查看交付提交的 CI，不能用本地 Windows 结果代替。

安装、授权和修复契约见 [Shell 载荷说明](<shell-payloads.md>)。

## 历史：完整运行时安装测量（拆分前）

2026-10-15T05:03:41.557Z，Windows x64、Node v25.9.0，对包含全部 Windows Bash、PowerShell 7、FastCtx、原生 worker 和 IPC 的四组件包进行了独立 npm 安装：**10,327 个普通文件，720,855,200 字节**。相比上游基线少 2,850,521 字节（约 **0.394%**），不是旧不完整包声称的 99% 节省，不能据此宣称已解决上游 #37 的大体积问题。

测量包 SHA-256：`cfdcf64955da921dd73a072ed7570827d3be111311bb117ed3ddf7c0e187df3e`。这是当时的构建快照；后续配置挂载与路径修复会改变包内元数据或 JS 字节，不宣称最终提交与该归档逐字节相同。完整默认能力优先保留，未通过删去运行时换取体积。

复现方式：

```bash
pnpm build
pnpm --config.ignore-scripts=true pack --pack-destination .cache
node scripts/measure-install.mjs dsh-ops@0.3.0
node build/package-runtime.mjs
pnpm --filter @dshopslite/win32-x64 --config.ignore-scripts=true pack --pack-destination .cache
node scripts/measure-install.mjs .cache/dsh-ops-lite-<version>.tgz .cache/dshopslite-win32-x64-<version>.tgz
```

[测量脚本](<../scripts/measure-install.mjs>) 只创建和删除自己的临时目录；不安装到用户 Harness。Windows-only 上游 payload 的此项比较不能外推为 Unix 数据。

2026-10-15T08:30:00.402Z，当前 npm 分包方案重新执行独立安装，测得：

| 当前安装项 | 版本 | 文件数 | 字节 |
| --- | --- | ---: | ---: |
| `dsh-ops-lite` 主包 | 0.1.0 | 27 | 316,162 |
| `dsh-ops-lite-win32-x64` 完整运行时 | 0.1.0 | 10,301 | 720,521,499 |
| **当前平台安装合计** | | **10,328** | **720,837,661** |

相比上游基线少 2,868,060 字节（约 **0.396%**）。主包压缩归档为 183,433 字节，SHA-256 `047dd66525dc9ae8cd377c0bbe97625c51241a27a87c0f6f395d67c741f9cd60`；Windows 平台归档为 295,429,835 字节，SHA-256 `b858849571e9830ea6350b59d7d8c4ed2500e59e7e4ed21e4c579ea16e936b21`。这些是实际测量的构建快照，后续 JS 或元数据变化不保证相同归档字节。

npm 仅选择当前平台，不安装其他系统的运行时，无下载器或编译安装脚本。分包并未明显缩减完整 Windows 运行时，**上游 #37 的大体积问题仍未解决**；没有用删除功能换取体积。

## 打包权限约束

`pnpm pack` 会把非 `bin` 文件统一写成 `0644`，磁盘上的执行位不会进入 tgz。首个交付提交因此在 Unix 上出现 `spawn .../dsh-ops-worker EACCES`（worker 尚未启动，非产品逻辑失败）。两个 Unix 平台包现在用 pnpm 原生字段 `publishConfig.executableFiles` 声明 worker 与 fastctx；实测磁盘 `0644` 打包后为 `-rwxr-xr-x`。`scripts/runtime-package.test.mjs` 固定这两个清单，[E2E runner](<../test/e2e/run.mjs>) 在 Unix 上直接断言已打包 tgz 的记录模式，不靠安装后 `chmod` 掩盖。

## 检查与 E2E

[CI](https://github.com/hairyf/dsh-ops-lite/actions/workflows/ci.yml) 在三平台运行本地检查、原生 Rust 回归和真实隔离 Harness + Chromium L2。必须查看交付提交对应的所有适用 job；旧提交、跳过或只做编译不算功能通过。

[E2E runner](<../test/e2e/run.mjs>) 独立安装固定版本 `@deepseek-ai/dsh@0.2.1-alpha.1`，校验实际路径和版本，隔离 profile/home/workspace，随机端口，不回退到既有 Harness，不修改 core renderer，不调用 LLM。这不是 Tauri WebDriver L3。

以上测量记录均为发版前构建快照；包名调整后的归档文件名为 `dshopslite-<target>-<version>.tgz`。实际 npm 发布状态以注册表和对应 Release 工作流为准；没有向用户当前 Harness 安装插件。

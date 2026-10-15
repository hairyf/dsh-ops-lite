# Windows Shell 按需安装

本方案对应 [上游 #37](<https://github.com/T-Auto/dsh-ops/issues/37>)：默认平台包只带原生 worker、FastCtx 和必要 IPC，不携带完整 Bash / PowerShell。Shell 使用自持 npm 包，安装期检查本地环境后补齐；运行时不联网下载。

## 包与版本

| 包 | 内容 | 版本规则 |
| --- | --- | --- |
| `dsh-ops-lite` | 插件、无第三方依赖的安装脚本 | 插件版本 |
| `@dshopslite/win32-x64` | worker、FastCtx、Windows IPC | 跟随插件版本 |
| `@dshopslite/win32-x64-bash` | 完整 PortableGit Bash 目录 | 当前 pin：`2.56.0-windows.2` |
| `@dshopslite/win32-x64-pwsh` | 完整 PowerShell 目录 | 当前 pin：`7.6.6` |

只有 Windows、Linux 和 macOS 三个平台运行时包属于主包的 `optionalDependencies`；两个 Shell 包不在依赖图中。Bash 上游版本 `2.56.0.2` 不是 npm SemVer，因此映射为 `2.56.0-windows.2`。主包升级不反复发布未变的 Shell pin。

## 安装期行为

主包的 `postinstall` 只处理 Windows x64；其他平台不安装 Shell。每种 Shell 优先复用已验证的托管载荷或本地可执行文件，只有缺失时才调用 npm 安装精确 pin。不会编译 Rust / MSVC，不修改项目或 DSH profile 的依赖清单，不修改 PATH，也不运行载荷包的生命周期脚本。

本地检测包括 PATH 与常见 Git / PowerShell 安装位置，并通过有超时的版本探测排除不可运行文件和 PowerShell 5.1。Windows 的 WSL `System32/bash.exe` 不可复用；Git Bash 还必须匹配当前 IPC 支持的 MSYS DLL SHA256，否则仅该项改装固定载荷。记录绝对路径、检测版本与实测 SHA256，但**发现不等于授权**：执行仍需配置 `bashPath` 或 `allowSystemShellFallback: true`。配置路径保持最高优先级；路径无效会报错，不静默换成别的 Shell。受限执行仍保留原有 IPC 校验，不修改用户的 Git 目录。

### 控制项

在安装或手动修复前设置环境变量：

| 变量 | 值 | 效果 |
| --- | --- | --- |
| `DSH_OPS_SKIP_SHELL_PAYLOAD` | `1` | 跳过安装期 Shell 处理 |
| `DSH_OPS_SHELLS` | `bash` / `pwsh` / `both` / `none` | 选择补齐项；默认 `both` |
| `DSH_OPS_FORCE_MANAGED_SHELLS` | `1` | 不采用本地 Shell，补齐所选项的固定载荷；已验证的固定载荷仍复用 |
| `DSH_HOME` | 绝对路径 | 指定 DSH home；未设置时使用用户 home 下的 `.dsh` |

`none` 与 skip 只影响安装，不删除已有载荷或改变运行时权限。应确保安装器与实际 Harness 使用同一个 `DSH_HOME`；否则运行时找不到另一 home 的载荷。

### 被阻止的安装脚本、网络失败

pnpm 或 DSH 插件管理器可能阻止生命周期脚本。需要按其安全提示明确批准 `dsh-ops-lite` 的脚本；不应为此开放所有依赖的脚本。`--ignore-scripts` 会跳过补齐，不能期待插件首次运行时自动下载。

npm 下载、校验或写入失败时，安装脚本打印原因和修复命令，但退出码为 0，主包仍可安装；缺失 Shell 的能力在运行时明确报错。网络恢复或脚本获批后，使用与 Harness 相同的 `DSH_HOME` 执行：

```bash
npx --package dsh-ops-lite dsh-ops-provision-shells
```

也可在已安装主包目录中运行：

```bash
node scripts/provision-shells.mjs
```

手动修复失败返回非零退出码；这与不阻止主包安装的 `postinstall` 模式不同。加 `--force-managed` 可主动选择固定载荷。该命令是用户主动的安装操作，不是运行时下载器。

## 托管目录与校验

载荷保存在 `<DSH_HOME>/dsh-ops/shells/<kind>/<payloadVersion>/`：npm 安装结果位于其 `node_modules`，`.provisioned.json` 记录来源与 SHA256。安装使用 `--no-save --no-package-lock --ignore-scripts`，不污染 profile 或当前项目。

托管载荷必须同时满足包名、精确版本、目标平台、固定可执行路径、`payload.json` 与 pin 的 SHA256 一致。安装后与每次运行时解析都校验可执行文件；receipt 不是授权凭证，修改 receipt 不能绕过 pin 校验。本地 receipt 只有显式开启系统回退后才可使用，并须通过记录的版本、SHA256 与 Bash IPC 兼容性校验。Windows 未经安装器验证的 PATH 候选不会直接执行；本地文件变更后需重新运行修复命令。

运行时解析顺序：显式配置 → 验证过的托管载荷 → 兼容已有的 bundled 载荷 → 显式许可的本地 / 系统 Shell。整个流程不启动 npm、下载器或后台安装任务。沙箱与审批要求不因来源变化而放宽。

## 发布与验证

CI 构建并检查主包、平台包和两个独立 Windows 载荷 tarball；隔离安装通过仅监听 loopback 的测试注册表提供真实 tarball，执行主包安装脚本的 npm 补齐流程、校验 receipt / hash / Shell 版本，再离线复用并运行真实 Harness + Playwright。跨平台矩阵验证 Linux x64 和 macOS arm64。

发布前校验全部 tarball 清单及版本。查询精确 pin 已存在时，还须核对注册表身份、实际 tarball 的载荷元数据、可执行文件与 Bash MSYS DLL 的固定 SHA256，验证通过才跳过；只有明确不存在时才发布，身份或字节不匹配、认证、限流、网络等未知失败直接中止。顺序为 Shell 载荷 → 平台包 → 主包。

安装体积测量脚本 [measure-install.mjs](<../scripts/measure-install.mjs>) 明确禁用生命周期脚本，测的是基础依赖图中的普通文件逻辑大小，不含可选托管 Shell store、npm cache、文件系统分配和锁文件。全量选择两种 Shell 且本机缺失时，仍会另行占用两个完整载荷的空间；拆包消除默认携带，不宣称 Shell 本身体积消失。

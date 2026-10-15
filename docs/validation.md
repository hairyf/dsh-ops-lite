# 验证记录

## #37：实际安装体积

2026-10-15 在 Windows x64、Node v25.9.0 上，分别在系统临时目录中执行真实 npm 安装。禁用安装生命周期脚本，使用独立 home/cache，不连接或安装到用户 Harness。指标是安装包目录内**普通文件逻辑字节之和**，排除 npm cache、符号链接、包管理器锁文件、目录与 NTFS 分配开销；不是下载压缩大小。

| 安装对象 | 普通文件数 | 安装字节 | MiB |
| --- | ---: | ---: | ---: |
| `dsh-ops@0.3.0` 主包 | 200 | 6,000,575 | 5.72 |
| `@dsh-ops/bash-win32-x64@0.2.1` | 9,614 | 411,141,701 | 392.10 |
| `@dsh-ops/pwsh-win32-x64@0.2.1` | 661 | 256,628,393 | 244.74 |
| `@dsh-ops/fastctx-win32-x64@0.2.1` | 10 | 49,935,052 | 47.62 |
| **上游默认安装合计** | **10,485** | **723,705,721** | **690.18** |
| **本项目 Windows x64 包，0.1.0** | **182** | **5,635,146** | **5.37** |

本次默认安装减少 **718,070,575 字节（99.22%）**。新包安装输出为 `added 1 package`，无运行时 npm 依赖或 optionalDependencies；包含真实原生 worker、与固定 PortableGit 匹配的两个小型 IPC DLL、源码、许可及 JS/UI。没有把 Git Bash、PowerShell 或 FastCtx 二进制转移到另一项默认依赖。

被测 tarball 的 SHA-256：

```text
06c30f55d3b1d484d355887a131f32acd1b2615ecfe59baef06834cd09868729
```

这是本次本地构建产物的精确记录，不是对其它平台、后续提交或 npm 发行包的固定大小承诺。时间戳、编译器、Git 换行设置和源码变化均可能改变 tarball 摘要。显式执行 `provision` 后新增的可选运行时及构建缓存不计入“默认安装”，仍会另外占空间。

### 复现

从初始化了子模块的源码目录开始：

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:native
# Windows x64：先显式准备独立的固定 Bash，再用其 MSYS 根构建 IPC。
# DSH_HOME 必须是自行创建的测试目录，不要使用现有 Harness home。
node dist/cli.js provision --bash --managed
node scripts/build-bash-ipc.mjs --bash-root 'C:/absolute/test-home/dsh-ops/shells/bash/2.56.0.2'
pnpm --config.ignore-scripts=true pack --pack-destination .cache
node scripts/measure-install.mjs dsh-ops@0.3.0
node scripts/measure-install.mjs .cache/dsh-ops-next-0.1.0.tgz
```

[测量脚本](<../scripts/measure-install.mjs>) 会新建临时目录、执行 `npm install --ignore-scripts`、输出逐包文件数/字节 JSON，并仅删除它创建的临时目录。测量上游 Windows payload 需要相应下载流量；不要把 registry 的 unpackedSize 与此安装指标混用。Linux/macOS 不会安装上游 Windows-only payload，因此这里的前后体积比较仅适用于 Windows x64。

## 功能验证边界

- 本地完整 ESLint、TypeScript、Vitest（4 个文件、16 项检查）与 JS 构建已通过。保留 starter 的经典脚本模块加载器包装；publint 对该 CJS `.js` 客户端导出有格式提示，未通过关闭检查隐藏它。
- 本地 Windows 原生 release 构建、版本/来源摘要验证、Rust 路径分隔符回归、MSVC IPC 构建及输入 DLL 不变检查已通过。Unix 权限保留回归只在实际 Unix runner 执行，不以 Windows 编译代替。
- [CI](<https://github.com/hairyf/dsh-ops-next/actions/workflows/ci.yml>) 在 Windows/macOS/Linux 运行真实原生构建与隔离 Harness + Chromium **L2**：设置草稿/校验/持久化、原生文件操作、Bash、官方工具禁用/恢复、组件生命周期、显式 FastCtx 供应与后台任务、真实 PTC 调用，以及沙箱外部 canary。
- [E2E runner](<../test/e2e/run.mjs>) 在临时目录新装固定版本 `@deepseek-ai/dsh@0.2.1-alpha.1`；使用独立 profile、home、workspace、随机端口，不回退到用户已装 CLI、不修改 core renderer、不调用 LLM。这不是 Tauri WebDriver L3。
- 三平台通过与否必须查看**交付提交对应的完整 CI run**，不能把旧提交绿灯、仅静态检查或跳过的 job 当作成功。未发布 npm、未创建 release tag，也未向用户当前 Harness 安装插件。

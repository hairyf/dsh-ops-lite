# 验证记录

## 范围

交付必须先满足完整上游能力：普通会话无需保存配置，五个基础工具全部注册并真实执行；后台任务、PTC 与沙箱边界保持上游约束。配置仅保留禁用官方基础工具选项。源码实际维护于本仓库，构建由 tsdown 统一完成。

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

完整 fork 的新包需在全部运行时构建完成后重新安装测量，不沿用旧包装的摘要或节省比例。

```bash
pnpm build
pnpm --config.ignore-scripts=true pack --pack-destination .cache
node scripts/measure-install.mjs dsh-ops@0.3.0
node scripts/measure-install.mjs .cache/dsh-ops-next-0.1.0.tgz
```

[测量脚本](<../scripts/measure-install.mjs>) 只创建和删除自己的临时目录；不安装到用户 Harness。Windows-only 上游 payload 的此项比较不能外推为 Unix 数据。

## 检查与 E2E

[CI](https://github.com/hairyf/dsh-ops-next/actions/workflows/ci.yml) 在三平台运行本地检查、原生 Rust 回归和真实隔离 Harness + Chromium L2。必须查看交付提交对应的所有适用 job；旧提交、跳过或只做编译不算功能通过。

[E2E runner](<../test/e2e/run.mjs>) 独立安装固定版本 `@deepseek-ai/dsh@0.2.1-alpha.1`，校验实际路径和版本，隔离 profile/home/workspace，随机端口，不回退到既有 Harness，不修改 core renderer，不调用 LLM。这不是 Tauri WebDriver L3。

未发布 npm、未创建 release tag，未向用户当前 Harness 安装插件。

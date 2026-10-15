# dsh-ops-lite

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![coverage][coverage-src]][coverage-href]
[![License][license-src]][license-href]

> 注意，该项目还未完成，所以暂时不能安装

基于 [T-Auto/dsh-ops](<https://github.com/T-Auto/dsh-ops>) fork，仅新增以下改动：

- **多平台适配**：支持 Windows、macOS、Linux 的平台原生运行时构建。
- **多平台 E2E 测试**：[CI](<https://github.com/hairyf/dsh-ops-lite/actions/workflows/ci.yml>) 配置 Windows、macOS、Linux 的真实隔离 Harness + Playwright 测试。
- **禁用官方基础工具配置**：默认开启，切换即保存。开启后禁用官方基础文件与 Shell 工具，保留 read_image，不改变权限或沙箱。

徽章显示各服务的实际状态，不表示包已发布或覆盖率报告已上传。

## 上游

对照源码保留于 [source/dsh-ops](<source/dsh-ops>)，固定提交为 [`6e133320b4f7a81c289e05ff6afddc740cdef36e`](<https://github.com/T-Auto/dsh-ops/commit/6e133320b4f7a81c289e05ff6afddc740cdef36e>)。

## License

插件与原生核心：[MIT](<LICENSE.md>)；FastCtx：[Apache-2.0](<vendor/fastctx/LICENSE-APACHE>)，保留其 [NOTICE](<vendor/fastctx/NOTICE>) 与第三方许可。其他第三方组件遵循各自许可，构建产物保留相应声明。

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

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/dsh-ops-lite?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/dsh-ops-lite
[npm-downloads-src]: https://img.shields.io/npm/dm/dsh-ops-lite?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/dsh-ops-lite
[bundle-src]: https://img.shields.io/bundlephobia/minzip/dsh-ops-lite?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=dsh-ops-lite
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/dsh-ops-lite
[coverage-src]: https://codecov.io/gh/hairyf/dsh-ops-lite/graph/badge.svg
[coverage-href]: https://codecov.io/gh/hairyf/dsh-ops-lite
[license-src]: https://img.shields.io/github/license/hairyf/dsh-ops-lite.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/hairyf/dsh-ops-lite/blob/main/LICENSE.md

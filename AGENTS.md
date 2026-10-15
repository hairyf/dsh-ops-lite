# AGENTS.md

## 1. 项目架构与目录契约

* **架构**：Host half (`src/*.ts`) / Client half (`src/client/*.ts`)。
* **宿主侧**：
* `src/index.ts`（能力、工具、HTTP 路由、系统上下文）
* `src/types.ts`、`src/constants.ts`


* **客户端侧**：
* `src/client/types.ts`：**唯一**集中存放客户端共享类型的位置（禁止组件重复定义）。
* `src/client/constants.ts`：**唯一**集中存放常量（Slot、ID、API 前缀、样式 ID 等）的位置。
* `src/client/icons.ts`、`src/client/styles.ts`（样式标签挂载）。

## 2. 编码与技术规范

* **基础**：TypeScript (`strict`)、ESM (`"type": "module"`)、pnpm（通过 `pnpm-workspace.yaml` catalog 管理依赖）。
* **风格**：遵循 `@antfu/eslint-config`（**无 Prettier**）；使用相对路径导入；类型/常量必须显式导入。
* **组件**：React 组件统一使用 kebab-case（如 `extension-panel.tsx`）；优先复用 DeepSeek Harness 已有组件。
* **类型与常量**：跨文件类型/常量必须走集中文件；组件仅消费常量，不硬编码协议字符串。

## 3. 样式与生命周期规则

* **样式**：无 CSS-in-JS 运行时。通过单一 `<style data-plugin="..." data-plugin-css="...">` 标签挂载；样式由 `mount*Styles` 返回 disposer 并交由 `ctx.effect()` 管理。选择器限定在根 class 内，使用插件前缀。
* **生命周期 (`apply()`)**：
1. 注册/安装 locale、服务与协议。
2. `ctx.effect()` 挂载样式（返回 disposer）。
3. 注册 Slot 组件与 UI 行为。
4. `ctx.effect()` 管理 Observer、事件、定时器、DOM 补丁。

* **清理原则**：所有 effect 必须具备完备的 disposer（移除监听、取消异步、清理 DOM 标签与状态）。

## 4. Slot 与宿主安全规则

* **Slot**：使用 `constants.ts` 中的稳定常量（`name`、`id`、`registrant`、`order`、`priority`）；失败时必须 graceful fallback（禁止白屏）。
* **宿主侧**：
* Git/文件/进程 API 仅限 Host half。
* HTTP 路由严格限制方法并校验来源/权限。
* 破坏性 Git 操作必须原子化并校验每步结果，严禁静默覆盖用户分支、未提交改动或将 `process.cwd()` 作为未知 session 的 fallback。

## 5. 退级策略（优先级从高到低）

1. **官方公开 API**：严格对照当前安装版本的 `.d.ts`（禁止臆断）。
2. **DOM 补丁**：通过 MutationObserver 监听官方 DOM（仅限稳定 `aria-label` / `role` 选择器，禁用 CSS module 哈希）。
3. **降级/禁用**：无解时明确报错并禁用功能，严禁静默半工作状态。

## 6. 验证与交付检查

提交/完成前必须通过以下命令：

```bash
pnpm run lint --fix
pnpm run typecheck
pnpm run test -- --run
pnpm run build

```

* **检查清单**：共享类型/常量已归位 ｜ 样式单标签且带 disposer 完整清理 ｜ Slot 稳定且具兜底 ｜ 无数据/分支覆盖风险 ｜ 相关契约文档已同步。

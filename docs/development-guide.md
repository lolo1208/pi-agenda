# 开发与命名规范

## 产品标识

| 用途 | 名称 |
| --- | --- |
| 英文 / 中文 | Pi Console / 指派台 |
| 包名 / 推荐仓库目录 | `pi-console` |
| application ID | `dev.piconsole.desktop` |
| 桥接类型 / 对象 | `PiConsoleApi` / `window.piConsole` |
| 影子仓库与暂存区 | `~/.pi-console/projects/<项目路径哈希>/` |

## 命名约定

以语言与生态惯例为依据，项目内保持一致；不为无关领域类和变量加产品名前缀。

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| 目录、普通 TS、文档 | kebab-case | `shadow-git-manager.ts`、`development-guide.md` |
| React 组件文件与组件 | PascalCase | `App.tsx`、`ChangedFilesList` |
| 类、接口、类型 | PascalCase，无 I/T 前缀 | `ShadowGitManager`、`PiConsoleApi` |
| 变量、属性、函数 | camelCase，体现职责 | `snapshotManager`、`rendererUrl`、`createCheckpoint` |
| 布尔状态 | 优先 is/has/can/should | `isBusy`、`canRestore` |
| 固定模块常量 | UPPER_SNAKE_CASE | `IPC_CHANNELS`、`EXCLUDED_NAMES` |
| Hook | use + PascalCase | `useSession` |
| 测试文件 | 模块名 + `.test.ts(x)` | `shadow-git-manager.test.ts` |
| IPC 通道 | 领域:动作，使用共享常量 | `snapshot:create` |
| 数据库（接入时） | snake_case，表用复数 | `tool_calls`、`turn_id` |
| 自定义环境变量 | PI_CONSOLE_ + UPPER_SNAKE_CASE | `PI_CONSOLE_LOG_LEVEL` |

作具入口保留惯例，如 `index.ts`、`main.tsx`、`env.d.ts` 和 `electron.vite.config.ts`；外部 API 名称不重写。避免语义模糊的模块级 `data`、`manager`；局部循环索引可用 `i`。

使用 UTF-8、LF、两空格缩进，见 `.editorconfig`。TypeScript strict；不要用 `any` 绕过边界校验。格式化/lint 作具尚未接入，后续应纳入检查命令。

## 目录边界

```text
src/
  main/index.ts                      # 生命周期与 IPC
  main/snapshot/shadow-git-manager.ts
  preload/index.ts                   # 固定桥接方法
  shared/api.ts                      # DTO、通道常量、接口
  renderer/index.html
  renderer/src/main.tsx              # React 挂载
  renderer/src/App.tsx               # 工作台组件
  renderer/src/styles.css
  renderer/src/env.d.ts
tests/shadow-git-manager.test.ts
docs/
```

后续按领域增加 `main/agent`、`main/storage`、`main/tools` 和 Renderer 组件/Hook 目录，避免无职责的 utils 集合。共享层不依赖 Electron 或 Renderer。原生模块接入时明确 Electron ABI 与打包验证。

## pnpm 工作流

固定 `pnpm@12.6.0`，Node.js 24+。只提交 `pnpm-lock.yaml`；依赖变更使用 `pnpm add` / `pnpm add -D` / `pnpm remove`，同时提交 manifest 和锁文件。CI 冻结锁文件安装。

`pnpm-workspace.yaml` 使用 hoisted 布局以配合 Electron 打包，仅允许 Electron 和 esbuild 构建脚本。新增原生依赖逐项审查，不全局放行。参考 [pnpm 设置](https://pnpm.io/settings)及[锁文件导入](https://pnpm.io/cli/import)。

| 命令 | 用途 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 安装已锁依赖 |
| `pnpm dev` | 桌面热重载 |
| `pnpm typecheck` / `pnpm test` | 类型检查 / 集成测试 |
| `pnpm build` / `pnpm check` | 编译 / 聚合检查 |
| `pnpm pack:dir` | 本机未安装应用目录 |
| `pnpm dist:win` / `pnpm dist:mac` | 平台安装包 |
| `pnpm electron:install` | 显式下载并校验 Electron 运行时；dev/preview 自动先执行 |
| `pnpm rebuild esbuild` | 重建 esbuild 构建依赖 |

`pack:dir` 避免与 pnpm 内置 `pack` 混淆。输出 `out/` 和 `release/` 不提交。Windows 可用 `pnpm.cmd`。

### Electron uninstall 启动错误

若主进程和 Preload 编译成功，但启动时报 `Electron uninstall`，检查 Electron 二进制是否已安装。当前 Electron 44 的包没有安装时下载运行时的 postinstall，`pnpm rebuild electron` 可能直接成功但并未下载；应使用 `pnpm electron:install`（调用包内 `install-electron`）。`dev` 和 `preview` 已串联此步骤，下载失败时停止启动，避免显示误导性的应用卸载错误。`build` 保持纯编译，不需要桌面运行时。

下载失败时检查 GitHub Releases 的网络访问或代理。可按 [Electron 官方安装说明](https://www.electronjs.org/docs/latest/tutorial/installation)配置 `ELECTRON_MIRROR`；保留包内校验和，不关闭 TLS 或校验验证。

安装脚本复用 Electron 官方安装器，检测到已有 `HTTP_PROXY` / `HTTPS_PROXY`（含小写形式）时启用其代理支持，不写入或输出代理地址。下载超过 5 分钟会停止并提示重试；本机没有配置代理时保持默认直连。

## 交付与文档维护

说明行为变化、验证结果和未解决问题；编译通过不等于跨平台验收通过。需求更新规格，边界/数据格式更新架构，进度更新路线，验证追加验收记录。存储、应用 ID 或目录更名须说明兼容与迁移子响。

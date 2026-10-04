# Pi Console · 指派台

Pi Console 是面向 macOS 和 Windows 的本地桌面 AI 编程助手，基于 Electron、React 和 TypeScript 构建，让代码改动可查看、可追踪，并最终支持项目文件与对话上下文同步回滚。

当前已实现项目选择、手动快照、Monaco Diff，以及模型设置、加密凭证、连接测试和多轮文本对话。回复暂为非流式；SQLite、Agent 文件/终端工具和双轨回滚尚未实现。

开发计划还包含自定义/导入 Skill，以及内置计划模式：每轮弹出选项，末项支持自定义输入；需求澄清完毕后完整展示，用户最终确认后才执行。两项功能均待开发，详见产品规格和开发路线。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [产品与技术规格](docs/product-specification.md) | 定位、功能范围、技术栈和约束 |
| [架构规划](docs/architecture.md) | 进程边界、快照、数据模型和恢复协议 |
| [开发路线](docs/development-roadmap.md) | 阶段任务、交付标准和当前进度 |
| [验收测试](docs/acceptance-testing.md) | 场景步骤、通过标准和验证记录 |
| [开发规范](docs/development-guide.md) | pnpm、命名、目录和维护流程 |
| [模型配置与使用](docs/model-configuration.md) | 服务商配置、凭证、连接测试、文本对话与排错 |

## 快速开始

要求 Node.js 24+、pnpm 12.6.0、系统 Git。包管理器版本固定在 `package.json`，只维护 `pnpm-lock.yaml`。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Windows PowerShell 若限制执行 `.ps1`，使用 `pnpm.cmd`，无需修改系统策略。

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

`pnpm dev` 和 `pnpm preview` 会先执行 `pnpm electron:install`，确保 Electron 运行时已安装；已安装时直接跳过下载。当前 Electron 44 使用按需下载，`pnpm rebuild electron` 不能替代该步骤。

若 Electron 下载受阻，可先用 `pnpm install --frozen-lockfile --ignore-scripts` 安装检查和编译依赖；网络恢复后运行 `pnpm electron:install`。若 esbuild 安装脚本也被跳过且构建报错，运行 `pnpm rebuild esbuild`。

## 快照体验

打开测试项目 → 创建基准快照 → 外部编辑器增删改文件 → 捕获当前改动 → 点击文件查看内联或分栏 Diff。

快照仓库与暂存区保存在用户主目录 `~/.pi-console/projects/<项目路径哈希>/` 下，不会在项目目录创建 `.pi-console`。移除项目会清除对应快照仓库及暂存数据，项目文件本身会保留。快照和项目列表会持久化，对话仅在本次打开期间保留。

当前快照排除依赖、构建产物、元数据和部分凭证路径；拒绝符号链接、联接点及特殊文件。空目录、ACL、扩展属性和时间戳不属于覆盖范围；复制过程非原子操作，捕获时应停止外部写入。详见架构文档。

应用本地运行；使用远程模型时，发送的提示和代码会传输给相应服务商。

## 更名与兼容性

2026-10-04 起统一使用 Pi Console（指派台）；包名 `pi-console`，应用 ID `dev.piconsole.desktop`，桥接 `window.piConsole`。新检出目录建议命名 `pi-console`；当前项目物理路径不影响应用标识。

旧版 `.cherrypi` 快照保留原位并排除在新快照之外，当前不自动迁移；升级后需建立新基准。应用 ID 和产品名变化可能影响既有安装与用户数据目录，发布前须设计迁移方案。

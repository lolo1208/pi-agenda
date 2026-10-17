# 架构规划

适用产品：Pi Agenda · 行动派。更新日期：2026-10-09。完整技术栈见[产品规格](product-specification.md)，实现进度见[开发路线](development-roadmap.md)。

## 进程边界

当前会话由主进程保存到用户主目录的 `.pi-agenda/conversations.json`。会话列表、消息、图片、未发送草稿和选中会话在重启后恢复，不按时间或数量自动清理；只有用户确认删除对话或项目时才移除相应会话。写入采用临时文件加原子替换。读取失败时显示错误并禁止覆盖原文件，防止将未恢复的空列表保存为历史记录。

Renderer（React 19、Tailwind、git-diff-view）只负责界面；Preload 暴露固定的类型化方法，不透传 IPC 或 Node API；Main 持有项目选择权、文件系统与影子 Git。开启 contextIsolation、sandbox、webSecurity，关闭 nodeIntegration，拒绝额外窗口、导航和权限请求，并验证 IPC 来源及参数。

```text
Renderer → window.piAgenda → Preload → Main IPC → ShadowGitManager
                                             → ConversationStore
                                             → ModelSettingsStore / PiAgentService（pi SDK）
```

现有目录：`src/shared` 定义 DTO/IPC；`src/main/snapshot` 管理快照；`src/preload` 提供桥接；`src/renderer` 提供工作台。git-diff-view 与计算 Worker 打包进应用，不使用 CDN；对比区使用库默认的行底色、增删符号、词级高亮与上下文展开控件。

快照改动列表和文件对比按项目存储路径与提交哈希缓存，跨管理器实例合并重复读取，并限制缓存大小；删除项目存储时清除相应缓存。展示层过滤在主进程读取缓存之后执行，不写回缓存，因此回滚与还原仍拿到完整改动。`FileDiff.hunks` 携带含文件头的 Git 差异，前后全文并行读取并保留，供默认控件展开上下文。审批预览在 Worker 内生成差异；两类对比的高亮与视图数据也在 Worker 内准备，增删统计复用同一结果，统一/分栏切换无需重新计算。界面的准备结果缓存有容量上限，每个视图使用独立副本。

## 快照策略

项目影子仓库与独立暂存工作树保存在 `app.getPath('home')/.pi-agenda/projects/<项目路径 SHA-256>/shadow-git` 和 `staging` 下，能排除用户 Git 配置、属性过滤器及嵌套仓库的干扰，且不会在项目目录写入应用元数据。所有 Git 调用通过 simple-git 指定专用 GIT_DIR 与 GIT_WORK_TREE，隔离继承的 GIT_* 环境和全局配置，禁用换行转换、提交签名和钩子。强制添加符合快照策略的文件，因此原 `.gitignore` 不决定快照覆盖范围。改动列表只在展示层过滤：`src/main/snapshot/project-ignores.ts` 用 `ignore` 解析项目根与相关目录的 `.gitignore`，按 Git 的目录优先级匹配（深目录规则优先，父目录被排除时不读取其中的规则）；读取失败或路径异常按未忽略处理；不读取全局 gitignore 与 `.git/info/exclude`，匹配器按 `.gitignore` 的 mtime 与大小有限缓存。

单个 Manager 串行执行操作。当前仅支持单窗口/单个 Manager 使用项目；下一阶段需进程级项目锁与配额。快照前必须暂停 Agent 工具写入。识别改名暂按删除和新增处理；二进制展示状态，不渲染文本。Diff 路径必须出现在指定提交间的改动列表中。

原型排除任意层级的 `.git`、`.pi-agenda`、旧版 `.pi-console` 和 `.cherrypi`、`node_modules`、`dist`、`out`、`build-work`、`release`、旧版发行目录 `exports`、`.aws`、`.ssh`，以及 `.env` 与 `.env.*`。不以此替代秘密扫描。拒绝符号链接/联接点和特殊文件；Git 不记录空目录，当前不保证 ACL、扩展属性、时间戳及完整权限元数据。复制不是文件系统原子快照，大文件限制和外部写入冲突检测待实现。

## 后续数据模型与轮次

使用 better-sqlite3，数据库位于 app.getPath('userData')，启用迁移、外键与 WAL；该原生依赖在接入时添加并针对 Electron ABI 重建。

| 实体 | 核心字段 |
| --- | --- |
| Session | id, canonicalProject, title, activeBranchId |
| Turn | id, sessionId, parentTurnId, branchId, prompt, response, status |
| ToolCall | id, turnId, name, arguments, result, status |
| Checkpoint | id, turnId, phase(base/end/recovery), hash, createdAt |
| RestoreJournal | id, sessionId, targetTurnId, recoveryHash, phase |
| SkillDefinition | id, name, description, source(builtin/custom/imported), version, contentHash, enabled |
| Plan | id, sessionId, status, currentRevisionId |
| PlanRevision | id, planId, requirements, executionSteps, contentHash, createdAt |
| PlanQuestion | id, planId, turnId, prompt, options, answer, answeredAt |
| PlanConfirmation | id, planId, revisionId, confirmedAt, executionTurnId |

执行轮流程：锁项目 → 建立 base 快照 → 持久化运行中的 Turn → 执行有界 Agent 工具循环 → 无论成功、失败或取消均捕获 end 快照 → 保存 Diff 与轮次结果 → 解锁。计划澄清轮只保存对话与计划状态，不启动项目修改。崩溃恢复需区分孤立 Git 提交与未完成 Turn。

## Skill 与计划模式

主进程 `SkillRegistry` 管理内置、自定义及导入定义；`SkillImporter` 读取 `SKILL.md` 和资源清单，校验标识、引用路径与内容，拒绝资源越界和符号链接逃逸。用户定义保存在应用 userData 下的 skills 目录；内置计划 Skill 随应用打包、独立标识且不可被同名导入覆盖。导入不运行脚本，启用 Skill 也不扩大工具权限。任务记录所用版本/内容哈希，执行中修改 Skill 不静默改变正在运行的任务。

`PlanCoordinator` 管理计划状态：`clarifying → awaiting-confirmation → executing → completed`，支持取消；补充或修正转回 `clarifying` 并生成新需求版本。每轮发出结构化问题事件，包含问题 ID、选目及末目自定义输入；Renderer 用选目弹窗展示，通过受限 Preload 方法提交答案。服务端校验当前问题、答案与状态，不接受过期或重复提交推进流程。

需求明确后保存不可变 `PlanRevision`，向用户展示完整需求、执行步骤及影响范围。最终确认事件必须来自用户界面并绑定当前版本，主进程原子记录确认与执行轮关联；模型文本、Skill 指令、超时和预选状态都不能作为确认。重复点击确认只启动一个执行轮。

计划 Skill 负责提问和汇总，工具调度器负责强制执行权限限制，不能仅依赖提示词禁止操作。确认前仅开放计划记录与受限只读上下文工具，禁用文件写入、补丁、Shell 和其他副作用工具。确认后捕获执行前快照并基于已确认版本执行；范围变更必须重新确认，具体风险操作仍遵循独立审批。

持久化待答问题、答案、需求版本和确认状态；重启后展示当前状态，不自动开始或恢复执行。回滚对话时同步恢复对应计划版本，已归档分支的确认不得授权新分支执行。

## 双轨回滚（尚未开放）

文件系统与 SQLite 无法共享真正的事务，需要可恢复的日志协议：

1. 用户选择目标轮次，展示将覆盖、删除的文件与当前未捕获改动；等待明确确认，停止工具并锁定项目。
2. 捕获 recovery 快照，写入恢复日志并持久化目标版本。
3. 校验目标清单的路径范围、符号链接、大小写冲突；在受控临时目录解包，再按清单恢复。禁止对用户目录使用 git clean 或整树删除。
4. 文件恢复成功后，在 SQLite 事务中更新分支与活动轮次；历史默认归档并保留恢复入口。硬恢复与分支恢复作为显式选目。
5. 标记日志完成；崩溃后依据日志补全或恢复 recovery 快照。验收须覆盖各阶段注入失败后的再次启动。

## 模型、凭证与工具

代理模型请求的错误在 `model-request-error.ts` 中按实际 HTTP 状态、服务错误码及原因生成中文提示。HTTP 错误在 SDK 改写前从响应副本提取；流事件、会话持久化、计划生成与最终请求结果保留同一份脱敏信息。认证、请求限流、额度不足、参数、上下文、网络与服务端错误分别显示；未知原因明确说明服务未提供详情，不能按供应商名称推断为授权或额度故障。错误正文限量读取，不回显整份 JSON 中的请求体、凭据或 Cookie。

Main 已接入 `ModelSettingsStore`，通过 safeStorage 加密 API Key，写入 userData 下的版本化配置文件。Endpoint/参数与密钥密文分字段保存；渲染层读取仅返回配置元数据与 `hasApiKey`，新密钥经专用 IPC 提交后清空输入。加密不可用时禁止明文降级。详情见[模型配置](model-configuration.md)。

`ModelService` 控制单请求、超时和取消；模型调用统一经由主进程加载的 pi SDK（`@earendil-works/pi-coding-agent`），由其负责流式回复、工具执行、会话历史与上下文压缩。连接测试使用固定短消息，不读取聊天历史或启用项目工具。URL 与参数在主进程验证，请求禁止跟随重定向，上游错误正文不传到 UI；模型 IPC 继续验证来源。

文件工具要校验路径与符号链接边界；终端命令是实际本机执行，受限自动模式经系统沙箱隔离，完全访问模式需首次确认。需要审批请求、输出上限、超时、进程树终止与取消。设置/确认弹窗使用已接入的 shadcn/ui + Radix。

## 验证范围

Windows 其他命令的实际兼容性见 [常用命令沙箱诊断](windows-command-sandbox.md)。安全边界通过不代表工具兼容；PowerShell 路径 cmdlet、宿主工具安装位置、配置缓存及子进程分别验证。Agent 优先通过专用文件工具执行项目内文件操作，不能根据沙箱中的命令查找失败断定本机未安装工具，也不能自动放宽权限。

Windows 自动模式在工具执行层增加命令恢复协调：有限的单条文件命令通过语义及边界校验后自动委派文件工具；新建临时区预置隔离配置缓存。对有限运行时命令，原操作开始前只读检查可发现性，优先使用已有项目内运行时；只有确认尚未执行且宿主工具存在时才发起本次完整本机权限审批，批准后同一次调用继续。拒绝/取消和执行中的权限或超时失败按任务记录，防止重复申请或重放。工具结果中的 recovery 状态及原始错误供模型核对完成部分，任务状态复用现有 AgentEvent.status；不新增持久化权限或放开 ACL。诊断与隔离失败不能自动转本机执行。

Windows 隔离终端的 Git 配置与工作目录兼容性检查见 [Windows Git 沙箱诊断](windows-git-sandbox.md)。MXC 和 AppContainer 准备项目执行环境时，从真实项目目录针对临时空仓库执行 Git status；宿主可定位 Git、隔离进程却找不到时不能静默跳过检查。首次配置或排查中的探针失败沿用兼容后端选择流程。复用旧 MXC 记录时，明确的兼容性故障也会在执行用户脚本之前自动选择 AppContainer，完成完整隔离测试后继续原请求并保存新后端。实际执行阶段才出现指定的 Git cwd 权限错误时，也恢复到经过验证的 AppContainer；仅严格匹配的有限只读 Git 查询组合自动重试一次，其他脚本不重复执行。普通命令错误及隔离边界失败不触发自动恢复。隔离 Git 使用临时 HOME 并关闭宿主全局、系统配置继承，项目 `.git` 保持只读。

当前单元测试覆盖真实 Git 的增删改、CRLF、中文空格路径、空提交、二进制、排除策略、重新打开及原仓库索引不变。文件恢复尚未实现，不能声称已通过回滚验收。macOS Intel/Apple Silicon、Windows 安装包、原生模块、长路径与终端行为须在目标系统单独验证。

设计参考：[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[electron-vite 入门](https://electron-vite.org/guide/)、[Git 环境变量与命令文档](https://git-scm.com/docs/git)。

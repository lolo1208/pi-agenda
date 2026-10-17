# Windows 沙箱中的 Git 权限错误

只有 C 盘、项目位于 C 盘，都不是 Git 的使用限制。应区分普通终端与应用隔离终端；目录可以被 PowerShell 列出，也不代表 Git 的原生工作目录解析一定成功。

用户补充：故障机器在项目目录的普通命令提示符中执行 `git status --short` 有正常输出。这说明该次执行中的 Git、仓库和当前用户访问权限可用，排查重点是 Agent 额外施加的隔离令牌、文件授权、配置来源与启动工作目录，不能据此要求用户更换盘符或放宽整盘 ACL。普通终端与应用也可能因各自启动时的 PATH 不同而找到不同 Git，但截图中的错误已表明 Git 至少成功启动并进入仓库准备阶段。

用户进一步提供的 `C:\work\projects\rust\shuobei` 对照中，项目和 `.git` 可访问，父目录均不能读取属性或枚举。这证明了权限边界差异，但不能单凭最近被拒绝的父目录 `C:\work\projects\rust`，断定它就是 Git 内部失败的唯一位置。修复选择实际可运行 Git 的兼容隔离后端，不修改这些父目录的 ACL。

## 诊断依据

`fatal: Unable to read current working directory: Permission denied` 表示 Git 在解析当前工作目录时失败。Git for Windows 的 `mingw_getcwd` 会调用 `GetCurrentDirectoryW`、`GetFinalPathNameByHandleW`，后者失败时回退到 `GetLongPathNameW`。这条回退路径可能需要读取父目录，所以仅授权项目文件仍可能失败。

微软 MXC 仓库的 [#1464](https://github.com/microsoft/mxc/issues/1464) 报告了部分 Windows 系统下 DOS 卷路径转换被拒绝的现象，并附有原生 API 探针结果。该报告与截图吻合，但不能代替故障机器上的实测。参见 [Git for Windows 源码](https://github.com/git-for-windows/git/blob/v2.52.0.windows.1/compat/mingw.c)及 [GetLongPathNameW 的父目录权限说明](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getlongpathnamew)。

另一个独立问题是 `unable to access 'C:/Users/.../.gitconfig': Permission denied`，随后出现 `unknown error occurred while reading the configuration files`。原生 MXC 沙箱不能读取宿主用户目录，但之前继承的 `USERPROFILE` 会让 Git 尝试读取该位置。本次在 Windows build 26300、Git 2.52.0.windows.1 上复现了该配置错误，没有复现截图中的工作目录错误。

`--git-dir` 仅指定仓库元数据，不承诺跳过当前工作目录解析，因此不能作为通用修复。`safe.directory` 用于仓库所有者校验，也不能修复上述 Windows 路径 API 被拒绝的问题。

## 应用修复

后续修复增加了仅对 AppContainer Git 子进程可见的私有项目入口，避免 Git 解析 cwd 时枚举真实父目录。实现方式：宿主在内置 AppContainer 宿主中为 Git 子进程创建私有项目入口（匿名对象目录与进程设备映射），以项目自身作为盘符根；不使用宿主 `DefineDosDevice`，不修改全局盘符、父目录 ACL 或 Mount Manager 权限，不提升管理员权限。对完整匹配的有限 Git 查询组合，宿主直接创建暂停状态的原生 `mingw64/bin/git.exe`，使用原有 AppContainer 令牌、继承句柄白名单及 Job，在线程运行前仅给 Git 子进程应用映射，Git 使用 `-C` 切入私有根；应用不通过 `cmd/git.exe` 包装程序启动 Git。启动探针使用同一条原生隔离路径。支持裸 `git status`、`git diff`、`git diff --cached`、`git rev-parse --show-toplevel` 及 status/diff 的常见只读输出选项（允许最多三条分号/换行组合及选项换序）；可重试查询关闭 optional locks、fsmonitor、untracked cache、外部 diff 和 textconv。任意脚本、其他 Git 参数和修改命令不套用此路径；不能据此宣称所有开发工具的路径兼容性都已解决。对象生命周期绑定进程句柄；映射/校验失败保持关闭，不降级为无隔离执行。完全访问模式首次选择时确认，后续不再逐项审批。

本机验证：私有入口的 `GetLongPathNameW` 成功，同一 AppContainer 中真实物理路径返回错误码 5；真实令牌检查确认 Git 未脱离 AppContainer；并发项目各自隔离，项目外文件和联接读取被拒，取消与超时后宿主盘符集合不变。原故障机器仍需安装新构建复测。

启动探针之外的遗漏及修复：此前仅接受若干完整命令字符串，裸 status、裸 diff 和不带 stat 的 cached diff 被遗漏，一条未匹配会令整段脚本退回普通 PowerShell 启动路径。现以同一参数解析结果驱动 MXC 查询保护、AppContainer 私有映射和恢复后的重试判断，三处识别范围一致；仍拒绝写文件参数、外部 diff/textconv、项目外 no-index 对比、管道、重定向及混合修改脚本的自动重试。

- Windows 隔离命令使用专用临时区作为 `HOME` 和 `XDG_CONFIG_HOME`；`GIT_CONFIG_GLOBAL=NUL`、`GIT_CONFIG_NOSYSTEM=1`，避免读取隔离范围外的 Git 配置。项目自己的 `.git/config` 仍可读取。宿主的全局别名、过滤器及凭证配置不在自动隔离命令中继承。
- MXC 和 AppContainer 首次准备每个项目执行环境时，在隔离进程自己的临时区写入最小空仓库，再从真实项目目录执行 `git --no-optional-locks --git-dir=<临时仓库> --work-tree=<项目> status --porcelain --untracked-files=no`。空索引且关闭未跟踪文件扫描，探针不修改用户项目的 `.git`，也不遍历项目内容；宿主 PATH 能定位 `git.exe`、但隔离进程找不到 Git 时明确报兼容性故障，不能当作未安装而跳过。宿主和沙箱均未找到 Git 时才跳过 Git 检查。不能用 `git init <临时目录>` 单独判断项目 cwd，因为 Git 会先切换到该临时目录。两个后端都验证工作目录兼容性，不能仅因 AppContainer 能读写文件就判定 Git 可用。
- 首次配置或手动排查发现 MXC 启动或 Git 探针失败时，现有配置流程切换到 AppContainer，再执行完整的外部文件、应用数据、链接、子进程及网络隔离检测，通过后才启用自动执行。诊断步骤保留原始失败原因。
- 不增加全盘读取权限，不自动脱离沙箱执行用户命令。原有项目检测记录继续长期复用；复用 MXC 旧记录时，若实际启动探针抛出明确的 Git 兼容性错误，会在执行用户命令之前自动选择 AppContainer，完成完整隔离检测并保存新后端，然后继续原请求。普通命令报错、隔离边界失败不会触发这种恢复。并发请求共享修复；取消等待不执行用户命令；修复失败保持禁用且不循环重试。
- 补上启动探针通过、实际命令才失败的遗漏：MXC 命令返回非零退出码且包含完整的 `fatal: Unable to read current working directory: Permission denied` 错误行时，同样选择 AppContainer，完成真实项目 Git 探针和完整隔离验证。普通拒绝访问、非仓库、所有权校验等错误不触发后端切换。
- 运行时恢复后，只对严格匹配的 `git status --short`、`git diff --no-ext-diff`、`git diff --stat`、`git diff --cached --stat`、`git rev-parse --show-toplevel`（单条或最多三条组成的查询脚本）自动重试一次；拒绝带重定向、管道、命令替换、其他参数或修改命令的自动重试。首次 cwd 错误的短输出暂存，恢复成功只返回重试的实际结果；恢复失败保留原错误和验证失败原因。任意其他脚本只恢复环境，不重复已可能执行的操作，并明确告知未自动重跑。兼容后端再失败直接返回，不循环重试。

## 故障机器上的复测

1. 使用包含修复的应用版本；源码开发可运行 `pnpm dev`，已安装版本需重新构建并安装。
2. 受影响项目的旧 MXC 环境会在下一次 Agent 命令准备时检查兼容性；实际执行阶段才出现指定 cwd 错误时也能恢复。无需先手动排查，可在安全执行环境查看诊断步骤中的后端与失败原因。
3. 在同一个项目任务中运行 `git status --short; git diff --stat; git diff --cached --stat`，再检查 `git diff --no-ext-diff` 和 `git rev-parse --show-toplevel`。上述查询允许最多三条分号或换行组合；完全访问模式下不应出现逐条审批。
4. 如果仍失败，对照普通 PowerShell 中的 `Get-Command git -All`、`git --version`、`Get-Location` 和上述 Git 命令，保留应用所用后端、Windows build、项目绝对路径及完整输出。若普通终端也失败，应另查目录 ACL、链接目标或目录已移动等情况。

截图底部的 ChatGPT 订阅请求失败属于模型服务请求问题，不能由 Git 工作目录错误直接解释，应分别排查。

## 本地回归

`tests/windows-sandbox-git.test.ts` 使用实际 Git，在系统临时目录和开发工作目录下分别创建中文、空格路径的仓库，覆盖 MXC、AppContainer 的 status、diff、rev-parse、显式 git-dir，以及 Agent 工具包装和权限路由，并检查项目外读取、`.git/config` 与 `.git/index.lock` 写入仍被拒绝。`tests/sandbox-service.test.ts` 覆盖旧记录自动恢复、修复失败、并发与取消；`tests/native-git-probe.test.ts` 注入截图中的工作目录拒绝，确认它被识别为兼容性故障且不能运行用户脚本。

新增 C、D 盘多级 `work/projects/rust/shuobei` 项目回归：普通终端返回 `?? 111.bmp`，注入“准备通过、实际 MXC Git 才报 cwd 拒绝”，经过真实 `WindowsSandboxEngine` 的 AppContainer Git 探针和完整边界验证后，同一 Agent 请求自动重试成功，随后 diff 和 rev-parse 正常；父目录枚举与 Git 元数据写入仍被拒绝。注入的是原生错误触发条件，兼容后端执行和隔离验证均为真实操作，不能称为已在故障机器复现全部原始系统行为。

```powershell
$env:PI_RUNNER_APPCONTAINER_TEST='1'
$env:PI_RUNNER_NATIVE_SANDBOX_TEST='1'
pnpm test tests/windows-sandbox-git.test.ts
```

测试目录按项目约定不纳入 Git。真实测试依赖 Windows x64、本机 Git 和完整内置隔离运行时。

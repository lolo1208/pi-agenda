# Git 工作目录故障：后续修复范围

用户反馈：普通终端和完全访问模式正常，受限模式及“排查修复”仍在 Git 启动探针失败。

已核对 Git for Windows 2.52.0 的 `mingw_getcwd`：先调用 `GetFinalPathNameByHandleW` 获取 DOS 路径，失败后调用 `GetLongPathNameW`。Microsoft MXC 的 [问题 #1464](https://github.com/microsoft/mxc/issues/1464) 记录了隔离进程不能访问 Mount Manager 的相同问题；[Windows 文档](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getlongpathnamew) 明确说明长路径回退需要父目录的枚举权限。因此，仅切换 MXC/AppContainer 并不能保证解决问题。原故障机器的具体 API 返回码仍需实测确认。

## 已实施的修复

用户已明确授权实施和验证私有映射。在内置 AppContainer 宿主中为 Git 子进程创建私有项目入口，以项目自身作为盘符根，让 Git 的长路径回退不必枚举真实父目录。使用匿名对象目录和进程设备映射，不使用宿主 `DefineDosDevice`，不修改全局盘符、父目录 ACL 或 Mount Manager 权限，不提升管理员权限。

Windows 不会把私有映射自动传给 PowerShell 后续启动的 Git。为此，对完整匹配的有限 Git 查询组合，宿主直接创建暂停状态的原生 `mingw64/bin/git.exe`，使用原有 AppContainer 令牌、继承句柄白名单及 Job，在线程运行前仅给 Git 子进程应用映射；Git 使用 `-C` 切入私有根。宿主进程自身不切换设备映射。应用不通过 `cmd/git.exe` 包装程序间接启动 Git。启动探针使用同一条原生隔离路径，在临时空仓库验证实际项目可访问性；随后继续完整边界测试。

支持 `git status --short`、`git diff --no-ext-diff`、`git diff --stat`、`git diff --cached --stat`、`git rev-parse --show-toplevel` 及最多三条分号/换行组合。可重试查询关闭 optional locks、fsmonitor、untracked cache、外部 diff 和 textconv，保留索引内容。任意脚本、其他 Git 参数和修改命令不套用此路径；不能据此宣称所有开发工具的路径兼容性都已解决。

对象生命周期绑定进程句柄；取消或超时仍终止进程树并清理项目临时权限。映射/校验失败保持关闭，不降级为无隔离执行。完全访问模式则遵循用户新要求：选择模式时确认，后续文件操作、命令和脚本不再逐项审批，包括模型携带 `outsideSandbox=true` 的调用。

## 本机验证

私有入口的 `GetLongPathNameW` 成功；同一个 AppContainer 中真实物理路径返回错误码 5。真实令牌检查确认 Git 启动路径未脱离 AppContainer。并发项目各自读取对应内容，项目外文件和联接读取被拒绝，取消与超时后宿主盘符集合不变。

C、D 盘中文目录通过实际 Agent 工具链执行用户提供的三条组合查询；完全访问不触发审批，受限自动保持 `.git` 只读，索引内容不变。旧 MXC 故障注入触发兼容恢复，私有 Git 探针及完整隔离测试真实执行；原故障机器尚不可用，仍需安装新构建复测。

import { DEFAULT_COMMAND_APPROVAL_REASON, type ToolApproval } from '../../../shared/models'

const COMMAND_TOOLS = ['bash', 'powershell']

/** 终端命令审批使用独立弹窗展示完整命令，文件改动仍使用对比视图。 */
export function isCommandApproval(approval: ToolApproval): boolean {
  return COMMAND_TOOLS.includes(approval.tool) || typeof approval.args.command === 'string'
}

/** 只有编辑和写入需要文件对比，其余操作按普通审批展示。 */
export function isFileChangeApproval(approval: ToolApproval): boolean {
  return ['edit', 'write'].includes(approval.tool)
}

/** 审批弹窗展示的实际命令；缺少命令字段时退回完整参数。 */
export function approvalCommand(approval: ToolApproval): string {
  return typeof approval.args.command === 'string' ? approval.args.command : JSON.stringify(approval.args, null, 2)
}

/** 沙箱恢复会同时带上原命令，两者不同时需要在审批时对照展示。 */
export function approvalOriginalCommand(approval: ToolApproval): string | undefined {
  const original = approval.args.originalCommand
  return typeof original === 'string' && original && original !== approval.args.command ? original : undefined
}

/** 模式说明本身没有额外信息，命令弹窗只在真正需要扩权时展示原因。 */
export function commandApprovalNotice(approval: ToolApproval): string | undefined {
  const reason = approval.reason.trim()
  return !reason || reason === DEFAULT_COMMAND_APPROVAL_REASON ? undefined : reason
}

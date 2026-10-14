export type SandboxBackend = 'mxc' | 'appcontainer' | 'elevated' | 'seatbelt'
export type SandboxPhase = 'unconfigured' | 'running' | 'ready' | 'failed'
/** 检查页面与聊天提示共用步骤名称；后端只提供平台对应的实际探针。 */
export const SANDBOX_CHECKS = {
  environment: { label: '检查系统和内置执行程序', progress: '正在检查系统和隔离程序。' },
  repair: { label: '准备应用工作目录和隔离配置', progress: '正在准备安全执行环境的工作目录。' },
  compatibility: { label: '检查隔离后端能否限制项目外读取', progress: '正在确认隔离后端能限制项目外访问。' },
  launch: { label: '启动隔离进程，检查项目访问权限', progress: '正在启动隔离进程并确认项目访问权限。' },
  project: { label: '测试项目内文件的创建、读取、修改和删除', progress: '正在检测项目内文件操作是否正常。' },
  outside: { label: '测试项目外文件是否被禁止读取和修改', progress: '正在检测是否已拦截项目外文件访问。' },
  private: { label: '测试应用会话、凭据和快照目录的保护', progress: '正在检测应用内部数据是否受到保护。' },
  links: { label: '测试目录链接能否绕过项目边界', progress: '正在检测目录链接是否会绕过项目边界。' },
  children: { label: '测试子进程是否继承隔离限制', progress: '正在检测子进程是否继承隔离限制。' },
  network: { label: '测试本机与外部网络连接是否被禁止', progress: '正在检测是否已禁止网络访问。' }
} as const
export const SANDBOX_MESSAGES = {
  unconfigured: '首次准备安全执行环境，完成隔离检测后即可自动执行项目命令。',
  preparing: '正在准备安全执行环境。', progress: '正在准备安全执行环境，可继续聊天和操作项目文件。',
  diagnosing: '正在检查并修复基础问题。', reused: '已使用此项目保存的隔离检测结果。',
  ready: '隔离测试全部通过。项目内终端命令可以自动执行。', passed: '安全执行环境已通过检测',
  inspect: '安全执行环境需要手动检查'
} as const
export interface SandboxStep { id: string; label: string; status: 'waiting' | 'running' | 'passed' | 'failed'; detail?: string }
export interface SandboxState {
  project: string; operationId: string; phase: SandboxPhase; backend?: SandboxBackend
  steps: SandboxStep[]; message: string; updatedAt: number
  /** 复用已有检测记录时，不再次展示通过提示。 */
  reused?: boolean
}

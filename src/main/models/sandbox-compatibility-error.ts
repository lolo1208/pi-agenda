import { ModelError } from './model-validation'

/** 工具兼容性失败，不代表隔离边界测试失败，也不授权重跑任意用户脚本。 */
export class SandboxCompatibilityError extends ModelError {}

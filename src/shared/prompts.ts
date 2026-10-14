import { MAX_CUSTOM_PROMPT_LENGTH } from './models'

/** 三层提示词各自保留完整内容，额外预留分层说明的空间。 */
export const MAX_COMBINED_PROMPT_LENGTH = MAX_CUSTOM_PROMPT_LENGTH * 3 + 1024
export const MAX_CONVERSATION_NAME_LENGTH = 200

export function composeCustomPrompt(conversation?: string, project?: string, global?: string): string {
  const layers = [
    { label: '会话提示词（最高优先级）', content: conversation?.trim() },
    { label: '项目提示词（次优先级）', content: project?.trim() },
    { label: '全局提示词（最低优先级）', content: global?.trim() },
  ].filter(layer => layer.content)
  if (layers.length < 2) return layers[0]?.content ?? ''
  return ['以下自定义提示词按作用范围分层。指令冲突时，会话提示词优先于项目提示词，项目提示词优先于全局提示词；没有冲突的指令共同生效。',
    ...layers.map(layer => `【${layer.label}】\n${layer.content}`),
  ].join('\n\n')
}

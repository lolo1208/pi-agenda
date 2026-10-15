export interface LocalSkill {
  id: string
  name: string
  description: string
  enabled: boolean
}

export function validSkillIds(value: unknown): value is string[] | undefined {
  return value === undefined || Array.isArray(value) && value.length <= 32 && value.every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) && new Set(value).size === value.length
}

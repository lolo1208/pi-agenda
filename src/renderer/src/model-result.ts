import type { ModelResult } from '../../shared/models'

export function unwrapModelResult<T>(result: ModelResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

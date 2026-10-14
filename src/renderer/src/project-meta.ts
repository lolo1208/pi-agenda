export interface ProjectMeta { name?: string; prompt?: string }
export type ProjectMetaMap = Record<string, ProjectMeta>

const STORAGE_KEY = 'pi-agenda.project-meta'
export const MAX_PROJECT_NAME_LENGTH = 60

export function defaultProjectName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root
}

function isValidMeta(value: unknown): value is ProjectMeta {
  if (typeof value !== 'object' || value === null) return false
  const meta = value as ProjectMeta
  return (meta.name === undefined || typeof meta.name === 'string') && (meta.prompt === undefined || typeof meta.prompt === 'string')
}

export function readProjectMetaMap(): ProjectMetaMap {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const entries = Object.entries(raw as Record<string, unknown>).filter(([root, meta]) => typeof root === 'string' && root.length > 0 && isValidMeta(meta))
    return Object.fromEntries(entries) as ProjectMetaMap
  } catch {
    return {}
  }
}

export function writeProjectMetaMap(meta: ProjectMetaMap): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
    return true
  } catch {
    return false
  }
}

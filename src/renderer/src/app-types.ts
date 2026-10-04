export interface Task {
  id: string
  title: string
  preview: string
  project: string | null
}

export const UNLINKED_PROJECT_LABEL = '未关联项目'

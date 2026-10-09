export function formatTaskTime(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined || !Number.isFinite(updatedAt)) return ''
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天`
  if (days < 30) return `${Math.floor(days / 7)} 周`
  return new Date(updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

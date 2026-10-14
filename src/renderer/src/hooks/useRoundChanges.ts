import { useLayoutEffect, useRef, useState } from 'react'
import type { ChangedFile } from '../../../shared/api'
import type { AgentSnapshot } from '../../../shared/models'
import { checkRoundFileStates, PROJECT_FILES_RESTORED, type RoundFileState } from './useRoundFileState'

export interface RoundChangesData {
  status: 'waiting' | 'loading' | 'loaded' | 'error'
  files?: ChangedFile[]
  error?: string
  fileState?: RoundFileState
}

export const roundChangesKey = (round: AgentSnapshot): string => JSON.stringify([round.project, round.before.hash, round.after.hash])

/** 同一会话只提交一个快照请求，始终从最新的可见范围选择下一项。 */
export function useRoundChanges(rounds: AgentSnapshot[], visible: string[], active: boolean, disabled: boolean, ready: boolean) {
  const [data, setData] = useState<Record<string, RoundChangesData>>({})
  const cache = useRef<Record<string, RoundChangesData>>({})
  const input = useRef({ rounds, visible, active: false, disabled, ready })
  const generation = useRef(0)
  const checkVersion = useRef(0)
  const checked = useRef(new Map<string, { version: number; at: number }>())
  const running = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(false)

  const publish = (key: string, value: RoundChangesData): void => {
    cache.current = { ...cache.current, [key]: value }
    if (mounted.current) setData(cache.current)
  }
  const schedule = (delay = 0): void => {
    if (!mounted.current || running.current || !input.current.active || !input.current.ready) return
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = undefined; void pump() }, delay)
  }
  const pump = async (): Promise<void> => {
    const current = input.current
    if (running.current || !mounted.current || !current.active || !current.ready) return
    const keys = current.rounds.map(roundChangesKey)
    const visibleSet = new Set(current.visible)
    const visibleRounds = current.rounds.filter(round => visibleSet.has(roundChangesKey(round)))
    const lastVisible = keys.reduce((last, key, index) => visibleSet.has(key) ? index : last, -1)
    const firstVisible = keys.findIndex(key => visibleSet.has(key))
    const order = firstVisible < 0 ? [...current.rounds].reverse() : [
      ...visibleRounds,
      ...current.rounds.slice(lastVisible + 1),
      // 可见轮次之间可能夹着暂时未相交的卡片，也属于后续补充范围。
      ...current.rounds.slice(firstVisible, lastVisible + 1).filter(round => !visibleSet.has(roundChangesKey(round))).reverse(),
      ...current.rounds.slice(0, firstVisible).reverse()
    ]
    const waiting = (round: AgentSnapshot): boolean => !cache.current[roundChangesKey(round)] || cache.current[roundChangesKey(round)].status === 'waiting'
    const visibleNext = visibleRounds.find(waiting)
    const next = visibleNext ?? order.find(waiting)
    const visibleFinished = !visibleNext
    const checkCandidates = visibleFinished && !current.disabled
      ? (next ? visibleRounds : current.rounds).filter(round => {
        const key = roundChangesKey(round)
        return cache.current[key]?.status === 'loaded' && checked.current.get(key)?.version !== checkVersion.current
      }) : []
    const session = generation.current
    const version = checkVersion.current
    const valid = (): boolean => mounted.current && input.current.active && generation.current === session
    running.current = true
    try {
      if (checkCandidates.length) {
        // 可见列表先显示再检查；背景列表补齐后集中检查，避免逐轮扫描项目。
        const project = checkCandidates[0].project
        const batch = checkCandidates.filter(round => round.project === project)
        try {
          const states = await checkRoundFileStates(batch)
          if (valid() && checkVersion.current === version && !input.current.disabled) {
            const eligible = new Set(input.current.rounds.map(roundChangesKey))
            for (const round of batch) {
              const key = roundChangesKey(round)
              if (!eligible.has(key)) continue
              checked.current.set(key, { version, at: Date.now() })
              publish(key, { ...cache.current[key], fileState: states[round.after.hash] })
            }
          }
        } catch {
          if (valid() && checkVersion.current === version && !input.current.disabled) {
            for (const round of batch) {
              const key = roundChangesKey(round)
              checked.current.set(key, { version, at: Date.now() })
              const previous = cache.current[key]
              publish(key, { ...previous, fileState: previous.fileState === 'matches' || previous.fileState === 'different' ? previous.fileState : 'error' })
            }
          }
        }
      } else if (next) {
        const key = roundChangesKey(next)
        publish(key, { status: 'loading' })
        try {
          const files = await window.piAgenda.getChanges(next.before.hash, next.after.hash, next.project)
          if (valid() && input.current.rounds.some(round => roundChangesKey(round) === key)) publish(key, { status: 'loaded', files })
          else publish(key, { status: 'waiting' })
        } catch (error) {
          if (valid()) publish(key, { status: 'error', error: error instanceof Error ? error.message : '文件改动读取失败，请重试' })
          else publish(key, { status: 'waiting' })
        }
      }
    } finally {
      running.current = false
      if (next || checkCandidates.length) schedule()
    }
  }

  useLayoutEffect(() => {
    mounted.current = true
    const invalidate = (event: Event): void => {
      if (input.current.rounds.some(round => round.project === (event as CustomEvent<string>).detail)) {
        checkVersion.current++
        schedule(250)
      }
    }
    const focus = (): void => {
      if (!input.current.active) return
      for (const round of input.current.rounds) {
        const key = roundChangesKey(round)
        const last = checked.current.get(key)
        if (last && Date.now() - last.at >= 60000) checked.current.delete(key)
      }
      schedule(250)
    }
    window.addEventListener(PROJECT_FILES_RESTORED, invalidate)
    window.addEventListener('focus', focus)
    return () => {
      mounted.current = false
      generation.current++
      if (timer.current !== undefined) clearTimeout(timer.current)
      window.removeEventListener(PROJECT_FILES_RESTORED, invalidate)
      window.removeEventListener('focus', focus)
    }
  }, [])

  useLayoutEffect(() => {
    if (input.current.active !== active) generation.current++
    if (disabled && !input.current.disabled) checkVersion.current++
    if (active && !input.current.active) {
      for (const [key, last] of checked.current) if (Date.now() - last.at >= 60000) checked.current.delete(key)
    }
    input.current = { rounds, visible, active, disabled, ready }
    if (!active && timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined }
    schedule()
  }, [rounds, visible, active, disabled, ready])

  const retry = (round: AgentSnapshot): void => {
    const key = roundChangesKey(round)
    if (cache.current[key]?.status !== 'error') return
    publish(key, { status: 'waiting' })
    schedule()
  }
  return { data, retry }
}

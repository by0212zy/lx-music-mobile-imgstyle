import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { throttle } from '@/utils/common'

// 每首歌的已听进度：以 musicInfo.id 为键
export interface ListenProgressItem {
  time: number
  maxTime: number
}

type ListenProgressMap = Record<string, ListenProgressItem>

const STORAGE_KEY = storageDataPrefix.listenProgress

let progressMap: ListenProgressMap = {}
let inited = false

// 按歌曲 id 精确订阅，避免一首歌进度变化导致列表所有项重渲染
type ProgressListener = (item: ListenProgressItem | null) => void
const listeners = new Map<string, Set<ProgressListener>>()

const saveThrottle = throttle(() => {
  void saveData(STORAGE_KEY, progressMap)
}, 3000)

export const initListenProgress = async() => {
  if (inited) return
  inited = true
  const data = await getData<ListenProgressMap>(STORAGE_KEY)
  if (data && typeof data === 'object') progressMap = data
}

// 获取某首歌的已听百分比（0-100），无记录返回 0
export const getListenPercent = (id: string): number => {
  const item = progressMap[id]
  if (!item || item.maxTime <= 0 || item.time <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(item.time / item.maxTime * 100)))
}

export const getListenProgressItem = (id: string): ListenProgressItem | null => {
  return progressMap[id] ?? null
}

// 记录进度。仅在百分比变化时通知对应订阅者，节流持久化
export const setListenProgress = (id: string, time: number, maxTime: number) => {
  if (!id || maxTime <= 0 || time < 0) return
  const prevPercent = getListenPercent(id)
  const next: ListenProgressItem = { time, maxTime }
  progressMap[id] = next
  const nextPercent = getListenPercent(id)
  saveThrottle()
  if (nextPercent !== prevPercent) {
    const set = listeners.get(id)
    if (set) for (const fn of set) fn(next)
  }
}

// 立即持久化（切歌/后台时调用，避免节流窗口内丢失）
export const flushListenProgress = () => {
  void saveData(STORAGE_KEY, progressMap)
}

export const subscribeListenProgress = (id: string, listener: ProgressListener): (() => void) => {
  let set = listeners.get(id)
  if (!set) {
    set = new Set()
    listeners.set(id, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
    if (set && set.size === 0) listeners.delete(id)
  }
}

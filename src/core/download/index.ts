import { downloadFile, stopDownload, existsFile, mkdir, unlink, writeFile, privateStorageDirectoryPath } from '@/utils/fs'
import { getData, saveData } from '@/plugins/storage'
import { getMusicUrl as getOnlineMusicUrl, getLyricInfo as getOnlineLyricInfo } from '@/core/music/online'
import { getPlayQuality } from '@/core/music/utils'
import settingState from '@/store/setting/state'
import { toast } from '@/utils/tools'

// 图片样式版：移动端本地下载管理
// 任务：队列下载音频 + 歌词，持久化下载列表，播放优先读本地文件

const STORAGE_KEY = '@imgstyle_download_list'
export const DOWNLOAD_DIR = `${privateStorageDirectoryPath}/imgstyle_downloads`

export type DownloadStatus = 'waiting' | 'running' | 'completed' | 'error' | 'paused'

export interface DownloadItem {
  id: string
  name: string
  singer: string
  source: LX.OnlineSource
  quality: LX.Quality
  ext: string
  filePath: string
  lyricPath: string
  status: DownloadStatus
  progress: number
  error?: string
  addedAt: number
  musicInfo: LX.Music.MusicInfoOnline
}

type DownloadListener = (list: DownloadItem[]) => void

const listeners = new Set<DownloadListener>()
let downloadList: DownloadItem[] = []
let loaded = false
const jobMap = new Map<string, number>()
const queue: string[] = []
const CONCURRENCY = 3
let running = 0

const notify = () => {
  const snapshot = downloadList.map(i => ({ ...i }))
  listeners.forEach(listener => { listener(snapshot) })
  global.app_event?.downloadListUpdate?.()
}

const persist = () => {
  void saveData(STORAGE_KEY, downloadList.map(({ musicInfo, ...rest }) => ({ ...rest, musicInfo })))
}

export const subscribeDownloadList = (listener: DownloadListener): (() => void) => {
  listeners.add(listener)
  if (loaded) listener(downloadList.map(i => ({ ...i })))
  return () => { listeners.delete(listener) }
}

export const getDownloadList = (): DownloadItem[] => downloadList.map(i => ({ ...i }))

export const getDownloadItem = (id: string): DownloadItem | undefined => {
  const item = downloadList.find(i => i.id === id)
  return item ? { ...item } : undefined
}

const ensureLoaded = async() => {
  if (loaded) return
  loaded = true
  try {
    const saved = await getData<DownloadItem[]>(STORAGE_KEY)
    if (Array.isArray(saved)) {
      // 校验文件是否仍存在
      downloadList = await Promise.all(saved.map(async item => {
        if (item.status === 'completed' && !await existsFile(item.filePath).catch(() => false)) {
          return { ...item, status: 'error' as DownloadStatus, error: '文件已丢失' }
        }
        return item
      }))
    }
  } catch (err) {
    console.log('load download list error', err)
  }
  notify()
}

const extOf = (quality: LX.Quality): string => quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3'

// 获取已下载文件路径（播放优先使用）
export const getDownloadedFilePath = async(musicInfo: LX.Music.MusicInfo): Promise<string | null> => {
  await ensureLoaded()
  const item = downloadList.find(i => i.id === musicInfo.id && i.status === 'completed')
  if (!item) return null
  const exists = await existsFile(item.filePath).catch(() => false)
  return exists ? item.filePath : null
}

export const isDownloaded = async(musicInfo: LX.Music.MusicInfo): Promise<boolean> => {
  return !!(await getDownloadedFilePath(musicInfo))
}

const pump = () => {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!
    const item = downloadList.find(i => i.id === id)
    if (!item || item.status !== 'waiting') continue
    running++
    void runTask(item)
  }
}

const updateItem = (id: string, patch: Partial<DownloadItem>) => {
  const item = downloadList.find(i => i.id === id)
  if (!item) return
  Object.assign(item, patch)
  notify()
}

const downloadLyric = async(item: DownloadItem) => {
  try {
    const lyricInfo = await getOnlineLyricInfo({ musicInfo: item.musicInfo, isRefresh: false })
    if (lyricInfo?.lyric) {
      await writeFile(item.lyricPath, lyricInfo.lyric, 'utf8')
    }
  } catch (err) {
    console.log('download lyric failed', err)
  }
}

const runTask = async(item: DownloadItem) => {
  updateItem(item.id, { status: 'running', progress: 0 })
  try {
    const quality = item.quality ?? getPlayQuality(settingState.setting['player.playQuality'], item.musicInfo)
    const url = await getOnlineMusicUrl({ musicInfo: item.musicInfo, quality, isRefresh: true })
    await mkdir(DOWNLOAD_DIR)
    const result = await new Promise<{ statusCode: number, bytesWritten: number }>((resolve, reject) => {
      const job = downloadFile(url, item.filePath, {
        progressInterval: 400,
        progressDivider: 1,
        begin: () => {},
        progress: ({ contentLength, bytesWritten }) => {
          if (contentLength > 0) {
            updateItem(item.id, { progress: Math.min(1, bytesWritten / contentLength) })
          }
        },
      })
      jobMap.set(item.id, job.jobId)
      job.promise.then(res => { resolve({ statusCode: res.statusCode, bytesWritten: res.bytesWritten }) }).catch(reject)
    })
    jobMap.delete(item.id)
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(`HTTP ${result.statusCode}`)
    updateItem(item.id, { status: 'completed', progress: 1 })
    void downloadLyric(item)
    persist()
  } catch (err: any) {
    jobMap.delete(item.id)
    if (err?.message === 'Download stopped' || err?.message === 'aborted') {
      updateItem(item.id, { status: 'paused' })
    } else {
      updateItem(item.id, { status: 'error', error: err?.message ?? '下载失败' })
    }
    persist()
  } finally {
    running--
    pump()
  }
}

export const addDownloadTasks = async(musicInfos: LX.Music.MusicInfoOnline[], quality?: LX.Quality) => {
  await ensureLoaded()
  let added = 0
  for (const musicInfo of musicInfos) {
    if (downloadList.some(i => i.id === musicInfo.id)) continue
    const q = quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo)
    const ext = extOf(q)
    const item: DownloadItem = {
      id: musicInfo.id,
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: musicInfo.source,
      quality: q,
      ext,
      filePath: `${DOWNLOAD_DIR}/${musicInfo.id}.${ext}`,
      lyricPath: `${DOWNLOAD_DIR}/${musicInfo.id}.lrc`,
      status: 'waiting',
      progress: 0,
      addedAt: Date.now(),
      musicInfo,
    }
    downloadList.unshift(item)
    queue.push(item.id)
    added++
  }
  if (added) {
    persist()
    notify()
    pump()
    toast(`已添加 ${added} 首到下载列表`)
  } else {
    toast('歌曲已在下载列表中')
  }
  return added
}

export const removeDownloadTask = async(id: string, deleteFile = true) => {
  await ensureLoaded()
  const item = downloadList.find(i => i.id === id)
  if (!item) return
  if (item.status === 'running') {
    const jobId = jobMap.get(id)
    if (jobId != null) stopDownload(jobId)
  }
  if (deleteFile) {
    if (await existsFile(item.filePath).catch(() => false)) await unlink(item.filePath).catch(() => {})
    if (await existsFile(item.lyricPath).catch(() => false)) await unlink(item.lyricPath).catch(() => {})
  }
  downloadList = downloadList.filter(i => i.id !== id)
  const qIndex = queue.indexOf(id)
  if (qIndex > -1) queue.splice(qIndex, 1)
  persist()
  notify()
}

export const clearCompletedDownloads = async() => {
  await ensureLoaded()
  const completed = downloadList.filter(i => i.status === 'completed')
  for (const item of completed) {
    if (await existsFile(item.lyricPath).catch(() => false)) await unlink(item.lyricPath).catch(() => {})
  }
  downloadList = downloadList.filter(i => i.status !== 'completed')
  persist()
  notify()
}

export const retryDownloadTask = async(id: string) => {
  await ensureLoaded()
  const item = downloadList.find(i => i.id === id)
  if (!item) return
  item.status = 'waiting'
  item.progress = 0
  item.error = undefined
  queue.push(id)
  notify()
  pump()
}

export const initDownload = () => { void ensureLoaded() }

import { downloadFile, stopDownload, existsFile, mkdir, unlink, writeFile, stat } from '@/utils/fs'
import RNFS from 'react-native-fs'
import { getData, saveData } from '@/plugins/storage'
import { getMusicUrl as getOnlineMusicUrl, getLyricInfo as getOnlineLyricInfo } from '@/core/music/online'
import { getPlayQuality } from '@/core/music/utils'
import settingState from '@/store/setting/state'
import { toast, requestStoragePermission } from '@/utils/tools'

// 图片样式版：移动端本地下载管理
// 任务：队列下载音频 + 歌词，持久化下载列表，播放优先读本地文件
// 已下载记录独立持久化：清除任务不会丢失已下载标识

const STORAGE_KEY = '@imgstyle_download_list'
const RECORD_KEY = '@imgstyle_download_records'
// 保存到公共下载目录 Download/lx/
export const DOWNLOAD_DIR = `${RNFS.DownloadDirectoryPath}/lx`

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

// 已下载记录：与任务列表分离，长期保留用于播放/歌词/已下载标识
export interface DownloadRecord {
  id: string
  name: string
  singer: string
  filePath: string
  lyricPath: string
  addedAt: number
}

type DownloadListener = (list: DownloadItem[]) => void

const listeners = new Set<DownloadListener>()
let downloadList: DownloadItem[] = []
let loaded = false
let recordsLoaded = false
let downloadRecords: DownloadRecord[] = []
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

const persistRecords = () => {
  void saveData(RECORD_KEY, downloadRecords)
}

const ensureRecordsLoaded = async() => {
  if (recordsLoaded) return
  recordsLoaded = true
  try {
    const saved = await getData<DownloadRecord[]>(RECORD_KEY)
    if (Array.isArray(saved)) downloadRecords = saved
  } catch (err) {
    console.log('load download records error', err)
  }
}

const upsertRecord = async(record: DownloadRecord) => {
  await ensureRecordsLoaded()
  const index = downloadRecords.findIndex(i => i.id === record.id)
  if (index > -1) downloadRecords[index] = record
  else downloadRecords.unshift(record)
  persistRecords()
  notify()
}

const removeRecord = async(id: string) => {
  await ensureRecordsLoaded()
  if (!downloadRecords.some(i => i.id === id)) return
  downloadRecords = downloadRecords.filter(i => i.id !== id)
  persistRecords()
  notify()
}

export const subscribeDownloadList = (listener: DownloadListener): (() => void) => {
  listeners.add(listener)
  if (loaded) listener(downloadList.map(i => ({ ...i })))
  return () => { listeners.delete(listener) }
}

export const getDownloadList = (): DownloadItem[] => downloadList.map(i => ({ ...i }))
export const getDownloadRecords = (): DownloadRecord[] => downloadRecords.map(i => ({ ...i }))

export const getDownloadItem = (id: string): DownloadItem | undefined => {
  const item = downloadList.find(i => i.id === id)
  return item ? { ...item } : undefined
}

export const getDownloadRecord = (id: string): DownloadRecord | undefined => {
  const record = downloadRecords.find(i => i.id === id)
  return record ? { ...record } : undefined
}

const ensureLoaded = async() => {
  if (loaded) return
  loaded = true
  try {
    const saved = await getData<DownloadItem[]>(STORAGE_KEY)
    if (Array.isArray(saved)) {
      downloadList = saved
    }
  } catch (err) {
    console.log('load download list error', err)
  }
  await ensureRecordsLoaded()
  notify()
}

const extOf = (quality: LX.Quality): string => quality === 'flac' || quality === 'flac24bit' ? 'flac' : 'mp3'

// 文件名：歌名-作者，清理文件系统非法字符
const sanitizeFileName = (value: string): string => (value || '未知').replace(/[\\/:*?"<>|\r\n]/g, '_').trim()

// 获取已下载文件路径（播放优先使用）
export const getDownloadedFilePath = async(musicInfo: LX.Music.MusicInfo): Promise<string | null> => {
  await ensureRecordsLoaded()
  const record = downloadRecords.find(i => i.id === musicInfo.id)
  if (!record) return null
  const exists = await existsFile(record.filePath).catch(() => false)
  return exists ? record.filePath : null
}

export const isDownloaded = async(musicInfo: LX.Music.MusicInfo): Promise<boolean> => {
  return !!(await getDownloadedFilePath(musicInfo))
}

// 获取已下载 id 集合（同步，供列表标识使用）
export const getDownloadedIds = (): Set<string> => new Set(downloadRecords.map(i => i.id))

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
    // 写入已下载记录（与任务列表分离，清除任务不会丢失）
    await upsertRecord({
      id: item.id,
      name: item.name,
      singer: item.singer,
      filePath: item.filePath,
      lyricPath: item.lyricPath,
      addedAt: Date.now(),
    })
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
  // 保存到公共 Download/lx/ 目录需要存储权限
  await requestStoragePermission()
  let added = 0
  for (const musicInfo of musicInfos) {
    if (downloadList.some(i => i.id === musicInfo.id)) continue
    const q = quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo)
    const ext = extOf(q)
    const fileName = `${sanitizeFileName(musicInfo.name)}-${sanitizeFileName(musicInfo.singer)}`
    const item: DownloadItem = {
      id: musicInfo.id,
      name: musicInfo.name,
      singer: musicInfo.singer,
      source: musicInfo.source,
      quality: q,
      ext,
      filePath: `${DOWNLOAD_DIR}/${fileName}.${ext}`,
      lyricPath: `${DOWNLOAD_DIR}/${fileName}.lrc`,
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
    await removeRecord(id)
  }
  downloadList = downloadList.filter(i => i.id !== id)
  const qIndex = queue.indexOf(id)
  if (qIndex > -1) queue.splice(qIndex, 1)
  persist()
  notify()
}

// 清除已完成任务：只清任务列表，保留已下载记录、缓存与文件
export const clearCompletedDownloads = async() => {
  await ensureLoaded()
  downloadList = downloadList.filter(i => i.status !== 'completed')
  persist()
  notify()
}

// 缓存信息：已下载数量、总大小、失效数量
export const getDownloadCacheInfo = async() => {
  await ensureRecordsLoaded()
  let totalSize = 0
  let missing = 0
  for (const record of downloadRecords) {
    const exists = await existsFile(record.filePath).catch(() => false)
    if (exists) {
      const size = await stat(record.filePath).catch(() => null)
      totalSize += size?.size ?? 0
    } else {
      missing++
    }
  }
  return { count: downloadRecords.length, missing, totalSize }
}

// 检测下载文件是否仍然存在，返回缺失文件的记录 id
export const checkDownloadRecords = async(): Promise<string[]> => {
  await ensureRecordsLoaded()
  const missingIds: string[] = []
  for (const record of downloadRecords) {
    if (!await existsFile(record.filePath).catch(() => false)) missingIds.push(record.id)
  }
  return missingIds
}

// 清理下载文件不存在的缓存记录
export const cleanMissingDownloadRecords = async(): Promise<number> => {
  const missingIds = await checkDownloadRecords()
  if (missingIds.length) {
    downloadRecords = downloadRecords.filter(i => !missingIds.includes(i.id))
    persistRecords()
    notify()
  }
  return missingIds.length
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

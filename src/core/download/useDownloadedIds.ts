import { useEffect, useState } from 'react'
import { subscribeDownloadList, getDownloadList, getDownloadedIds, initDownload } from './index'

// 订阅下载列表，返回进行中/完成数量，用于导航栏角标
export const useDownloadListSummary = (): { running: number, completed: number } => {
  const [summary, setSummary] = useState(() => {
    const list = getDownloadList()
    return {
      running: list.filter(i => i.status === 'running' || i.status === 'waiting').length,
      completed: list.filter(i => i.status === 'completed').length,
    }
  })

  useEffect(() => {
    initDownload()
    return subscribeDownloadList(list => {
      setSummary({
        running: list.filter(i => i.status === 'running' || i.status === 'waiting').length,
        completed: list.filter(i => i.status === 'completed').length,
      })
    })
  }, [])

  return summary
}

// 订阅下载列表，返回已下载歌曲 id 集合（基于持久化的已下载记录）
export const useDownloadedIds = (): Set<string> => {
  const [ids, setIds] = useState<Set<string>>(() => new Set(getDownloadedIds()))

  useEffect(() => {
    initDownload()
    return subscribeDownloadList(() => {
      setIds(new Set(getDownloadedIds()))
    })
  }, [])

  return ids
}

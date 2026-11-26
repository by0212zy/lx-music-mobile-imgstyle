import { useEffect, useState } from 'react'
import { subscribeDownloadList, getDownloadList } from './index'

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
    return subscribeDownloadList(list => {
      setSummary({
        running: list.filter(i => i.status === 'running' || i.status === 'waiting').length,
        completed: list.filter(i => i.status === 'completed').length,
      })
    })
  }, [])

  return summary
}

// 订阅下载列表，返回已完成下载的歌曲 id 集合
export const useDownloadedIds = (): Set<string> => {
  const [ids, setIds] = useState<Set<string>>(() => new Set(
    getDownloadList().filter(i => i.status === 'completed').map(i => i.id),
  ))

  useEffect(() => {
    return subscribeDownloadList(list => {
      setIds(new Set(list.filter(i => i.status === 'completed').map(i => i.id)))
    })
  }, [])

  return ids
}

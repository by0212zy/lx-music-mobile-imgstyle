import { useEffect, useState } from 'react'
import { getListenPercent, initListenProgress, subscribeListenProgress } from './index'

// 订阅某首歌的已听百分比（0-100）。初始化后读取当前值，后续按 id 精确更新
export const useListenProgress = (id: string): number => {
  const [percent, setPercent] = useState(() => getListenPercent(id))

  useEffect(() => {
    void initListenProgress()
    const read = () => { setPercent(getListenPercent(id)) }
    read()
    return subscribeListenProgress(id, () => { read() })
  }, [id])

  return percent
}

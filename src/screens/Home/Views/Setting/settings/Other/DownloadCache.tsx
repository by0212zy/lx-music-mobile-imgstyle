import { memo, useState, useEffect, useCallback } from 'react'
import { View, StyleSheet } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { toast } from '@/utils/tools'
import { sizeFormate } from '@/utils'
import {
  getDownloadCacheInfo,
  cleanMissingDownloadRecords,
  initDownload,
} from '@/core/download'

export default memo(() => {
  const [info, setInfo] = useState<{ count: number, missing: number, totalSize: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    void getDownloadCacheInfo().then(setInfo)
  }, [])

  useEffect(() => {
    initDownload()
    refresh()
  }, [refresh])

  const handleCheck = useCallback(() => {
    if (busy) return
    setBusy(true)
    void cleanMissingDownloadRecords().then(removed => {
      toast(removed ? `已清理 ${removed} 条失效缓存` : '所有下载文件均存在')
      refresh()
    }).finally(() => { setBusy(false) })
  }, [busy, refresh])

  return (
    <SubTitle title="下载缓存">
      <View style={styles.info}>
        <Text>{info == null
          ? '获取中...'
          : `已下载 ${info.count} 首 · 占用 ${sizeFormate(info.totalSize)}${info.missing ? ` · 失效 ${info.missing}` : ''}`}</Text>
      </View>
      <View style={styles.buttons}>
        <Button disabled={busy || !info?.count} onPress={handleCheck}>检测并清理失效缓存</Button>
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  info: {
    marginBottom: 5,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { View, ScrollView, TouchableOpacity } from 'react-native'

import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import {
  subscribeDownloadList,
  getDownloadList,
  removeDownloadTask,
  retryDownloadTask,
  clearCompletedDownloads,
  type DownloadItem,
} from '@/core/download'
import { setMusicUrl } from '@/core/player/player'
import { setPlayMusicInfo } from '@/core/player/playInfo'

const statusText = (item: DownloadItem) => {
  switch (item.status) {
    case 'waiting': return '等待中'
    case 'running': return `下载中 ${Math.round(item.progress * 100)}%`
    case 'completed': return '已完成'
    case 'paused': return '已暂停'
    case 'error': return `失败${item.error ? `：${item.error}` : ''}`
    default: return ''
  }
}

const statusColor = (item: DownloadItem, theme: ReturnType<typeof useTheme>) => {
  if (item.status === 'completed') return theme['c-primary']
  if (item.status === 'error') return '#E5484D'
  return theme['c-350']
}

export default memo(() => {
  const theme = useTheme()
  const [list, setList] = useState<DownloadItem[]>(getDownloadList())

  useEffect(() => {
    const unsubscribe = subscribeDownloadList(items => { setList(items) })
    return unsubscribe
  }, [])

  const completedCount = useMemo(() => list.filter(i => i.status === 'completed').length, [list])
  const runningCount = useMemo(() => list.filter(i => i.status === 'running' || i.status === 'waiting').length, [list])

  const handlePlay = useCallback((item: DownloadItem) => {
    if (item.status !== 'completed') {
      toast('该歌曲尚未下载完成')
      return
    }
    setPlayMusicInfo(null, item.musicInfo, true)
    setMusicUrl(item.musicInfo)
  }, [])

  const handleRemove = useCallback((item: DownloadItem) => {
    void removeDownloadTask(item.id, true)
  }, [])

  const handleRetry = useCallback((item: DownloadItem) => {
    void retryDownloadTask(item.id)
  }, [])

  const handleClear = useCallback(() => {
    void clearCompletedDownloads().then(() => { toast('已清除下载任务，已下载歌曲仍保留') })
  }, [])

  return (
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
      <View style={styles.summary}>
        <Text size={13} color={theme['c-350']}>共 {list.length} 项 · 已完成 {completedCount} · 进行中 {runningCount}</Text>
        {
          completedCount > 0
            ? <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
                <Text size={13} color={theme['c-primary']}>清除已完成</Text>
              </TouchableOpacity>
            : null
        }
      </View>
      {
        list.length === 0
          ? <View style={styles.empty}>
              <Icon name="download-2" color={theme['c-350']} size={44} />
              <Text size={14} color={theme['c-350']} style={styles.emptyText}>暂无下载任务</Text>
              <Text size={12} color={theme['c-250']}>在歌曲菜单或列表多选里选择「下载」</Text>
            </View>
          : <ScrollView style={styles.list}>
              {list.map(item => (
                <View key={item.id} style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}>
                  <TouchableOpacity style={styles.itemMain} onPress={() => { handlePlay(item) }}>
                    <View style={styles.itemInfo}>
                      <Text size={14} color={theme['c-font']} numberOfLines={1}>{item.name}</Text>
                      <Text size={11} color={theme['c-500']} numberOfLines={1}>{item.singer} · {item.quality.toUpperCase()}</Text>
                      {
                        item.status === 'running'
                          ? <View style={styles.progressTrack}>
                              <View style={{ ...styles.progressFill, width: `${Math.round(item.progress * 100)}%`, backgroundColor: theme['c-primary'] }} />
                            </View>
                          : null
                      }
                      <Text size={11} color={statusColor(item, theme)}>{statusText(item)}</Text>
                    </View>
                    {
                      item.status === 'completed'
                        ? <Icon name="checkbox-marked" color={theme['c-primary']} size={20} />
                        : null
                    }
                  </TouchableOpacity>
                  <View style={styles.actions}>
                    {
                      item.status === 'error'
                        ? <TouchableOpacity onPress={() => { handleRetry(item) }} style={styles.actionBtn}>
                            <Text size={12} color={theme['c-primary']}>重试</Text>
                          </TouchableOpacity>
                        : null
                    }
                    <TouchableOpacity onPress={() => { handleRemove(item) }} style={styles.actionBtn}>
                      <Icon name="close" color={theme['c-350']} size={16} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
      }
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  list: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemInfo: {
    flex: 1,
    gap: 3,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  actionBtn: {
    padding: 6,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyText: {
    marginTop: 4,
  },
})

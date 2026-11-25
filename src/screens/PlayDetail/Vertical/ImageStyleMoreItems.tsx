import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { collectMusic, uncollectMusic } from '@/core/player/player'
import { getListMusics } from '@/core/list'
import { MUSIC_TOGGLE_MODE_LIST, MUSIC_TOGGLE_MODE, LIST_IDS } from '@/config/constant'
import { updateSetting } from '@/core/common'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import { createStyle, toast } from '@/utils/tools'

export const MoreItem = memo(({ children, label, onPress }: {
  children: ReactNode
  label: string
  onPress: () => void
}) => (
  <TouchableOpacity style={styles.moreItem} activeOpacity={0.6} onPress={onPress}>
    <View style={styles.moreIconBox}>{children}</View>
    <Text size={11} color="#A9A2C0">{label}</Text>
  </TouchableOpacity>
))

export const CollectItem = memo(() => {
  const musicInfo = usePlayerMusicInfo()
  const t = useI18n()
  const [collected, setCollected] = useState(false)

  const musicId = ((musicInfo as unknown as { metadata?: { musicInfo: LX.Music.MusicInfo } }).metadata?.musicInfo?.id ?? musicInfo.id)

  useEffect(() => {
    let mounted = true
    const load = () => {
      void getListMusics(LIST_IDS.LOVE).then(list => {
        if (mounted) setCollected(list.some(m => m.id === musicId))
      })
    }
    load()
    global.app_event.on('myListMusicUpdate', load)
    return () => {
      mounted = false
      global.app_event.off('myListMusicUpdate', load)
    }
  }, [musicId])

  const handlePress = useCallback(() => {
    if (collected) {
      uncollectMusic()
      toast('已取消收藏')
    } else {
      collectMusic()
      toast(t('collect_success'))
    }
    setCollected(!collected)
  }, [collected, t])

  return (
    <MoreItem label="收藏" onPress={handlePress}>
      <Icon name="love" color={collected ? '#FFB300' : '#D8D3E8'} size={18} />
    </MoreItem>
  )
})

export const PlayModeItem = memo(() => {
  const togglePlayMethod = useSettingValue('player.togglePlayMethod')
  const t = useI18n()

  const handlePress = useCallback(() => {
    let index = MUSIC_TOGGLE_MODE_LIST.indexOf(togglePlayMethod)
    if (++index >= MUSIC_TOGGLE_MODE_LIST.length) index = 0
    const mode = MUSIC_TOGGLE_MODE_LIST[index]
    updateSetting({ 'player.togglePlayMethod': mode })
    let modeName: 'play_list_loop' | 'play_list_random' | 'play_list_order' | 'play_single_loop' | 'play_single'
    switch (mode) {
      case MUSIC_TOGGLE_MODE.listLoop:
        modeName = 'play_list_loop'
        break
      case MUSIC_TOGGLE_MODE.random:
        modeName = 'play_list_random'
        break
      case MUSIC_TOGGLE_MODE.list:
        modeName = 'play_list_order'
        break
      case MUSIC_TOGGLE_MODE.singleLoop:
        modeName = 'play_single_loop'
        break
      default:
        modeName = 'play_single'
        break
    }
    toast(t(modeName))
  }, [togglePlayMethod, t])

  const playModeIcon = useMemo(() => {
    switch (togglePlayMethod) {
      case MUSIC_TOGGLE_MODE.listLoop: return 'list-loop'
      case MUSIC_TOGGLE_MODE.random: return 'list-random'
      case MUSIC_TOGGLE_MODE.list: return 'list-order'
      case MUSIC_TOGGLE_MODE.singleLoop: return 'single-loop'
      default: return 'single'
    }
  }, [togglePlayMethod])

  return (
    <MoreItem label="循环" onPress={handlePress}>
      <Icon name={playModeIcon} color="#D8D3E8" size={18} />
    </MoreItem>
  )
})

export const CommentItem = memo(() => {
  const handlePress = useCallback(() => {
    const componentId = commonState.componentIds.playDetail
    if (componentId) navigations.pushCommentScreen(componentId)
  }, [])

  return (
    <MoreItem label="评论" onPress={handlePress}>
      <Icon name="comment" color="#D8D3E8" size={18} />
    </MoreItem>
  )
})

const styles = createStyle({
  moreItem: {
    alignItems: 'center',
    gap: 5,
  },
  moreIconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
})

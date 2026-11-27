import { memo } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

interface Props {
  onScrollTop: () => void
  onScrollBottom: () => void
  onLocatePlaying: () => void
}

// 列表快捷导航：滚动到顶部、滚动到底部、定位到正在播放的歌曲
const ListNavButtons = memo(({ onScrollTop, onScrollBottom, onLocatePlaying }: Props) => {
  const theme = useTheme()
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.btn} activeOpacity={0.7} onPress={onScrollTop}>
        <Icon name="chevron-left" size={20} color={theme['c-primary-font']} style={styles.iconUp} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} activeOpacity={0.7} onPress={onScrollBottom}>
        <Icon name="chevron-left" size={20} color={theme['c-primary-font']} style={styles.iconDown} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} activeOpacity={0.7} onPress={onLocatePlaying}>
        <Icon name="play-outline" size={18} color={theme['c-primary-font']} />
      </TouchableOpacity>
    </View>
  )
})

const styles = createStyle({
  container: {
    position: 'absolute',
    right: 36,
    bottom: 20,
    zIndex: 11,
    gap: 9,
  },
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(150,150,170,0.22)',
    borderWidth: 0.6,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  iconUp: {
    transform: [{ rotate: '90deg' }],
  },
  iconDown: {
    transform: [{ rotate: '-90deg' }],
  },
})

export default ListNavButtons

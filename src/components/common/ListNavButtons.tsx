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
// 竖向胶囊条：统一磨砂容器 + 细分隔线，定位播放用主题色实心突出
const ListNavButtons = memo(({ onScrollTop, onScrollBottom, onLocatePlaying }: Props) => {
  const theme = useTheme()
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.btn} activeOpacity={0.6} onPress={onScrollTop}>
        <Icon name="chevron-left" size={20} color={theme['c-primary-font']} style={styles.iconUp} />
      </TouchableOpacity>
      <View style={styles.separator} />
      <TouchableOpacity style={styles.btn} activeOpacity={0.6} onPress={onScrollBottom}>
        <Icon name="chevron-left" size={20} color={theme['c-primary-font']} style={styles.iconDown} />
      </TouchableOpacity>
      <View style={styles.separator} />
      <TouchableOpacity
        style={[styles.btn, styles.btnPrimary, { backgroundColor: theme['c-primary'] }]}
        activeOpacity={0.7}
        onPress={onLocatePlaying}
      >
        <Icon name="play-outline" size={17} color="#FFFFFF" />
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
    width: 42,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: 21,
    backgroundColor: 'rgba(38,38,52,0.62)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 8,
  },
  btn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    borderRadius: 18,
  },
  separator: {
    width: 18,
    height: 0.5,
    marginVertical: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  iconUp: {
    transform: [{ rotate: '90deg' }],
  },
  iconDown: {
    transform: [{ rotate: '-90deg' }],
  },
})

export default ListNavButtons

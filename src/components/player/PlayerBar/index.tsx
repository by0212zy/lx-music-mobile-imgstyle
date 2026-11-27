import { memo, useMemo } from 'react'
import { PanResponder, View } from 'react-native'
import { useKeyboard } from '@/utils/hooks'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import { usePlayerMusicInfo } from '@/store/player/hook'

import Pic from './components/Pic'
import Title from './components/Title'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import { createStyle } from '@/utils/tools'
// import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'


export default memo(({ isHome = false }: { isHome?: boolean }) => {
  // const { onLayout, ...layout } = useLayout()
  const { keyboardShown } = useKeyboard()
  const theme = useTheme()
  const autoHidePlayBar = useSettingValue('common.autoHidePlayBar')
  const musicInfo = usePlayerMusicInfo()

  // 上滑播放栏打开播放界面；只在明显上滑时接管手势，不影响内部按钮点击
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_evt, g) => g.dy < -18 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
    onPanResponderRelease: (_evt, g) => {
      if (g.dy < -36 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2 && musicInfo.id) {
        navigations.pushPlayDetailScreen(commonState.componentIds.home!)
      }
    },
  }), [musicInfo.id])

  const playerComponent = useMemo(() => (
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }} {...panResponder.panHandlers}>
      <View style={styles.handleBar} />
      <Pic isHome={isHome} />
      <View style={styles.center}>
        <Title isHome={isHome} />
        {/* <View style={{ ...styles.row, justifyContent: 'space-between' }}>
          <PlayTime />
        </View> */}
        <PlayInfo isHome={isHome} />
      </View>
      <View style={styles.right}>
        <ControlBtn />
      </View>
    </View>
  ), [theme, isHome, panResponder])

  // console.log('render pb')

  return autoHidePlayBar && keyboardShown ? null : playerComponent
})


const styles = createStyle({
  container: {
    width: '100%',
    // height: 100,
    // paddingTop: progressContentPadding,
    // marginTop: -progressContentPadding,
    // backgroundColor: 'rgba(0, 0, 0, .1)',
    // borderTopWidth: BorderWidths.normal2,
    paddingTop: 16,
    paddingBottom: 10,
    paddingLeft: 5,
    // backgroundColor: AppColors.primary,
    // backgroundColor: 'red',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 10,
  },
  handleBar: {
    position: 'absolute',
    top: 6,
    left: '50%',
    marginLeft: -16,
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,170,0.35)',
  },
  left: {
    // borderRadius: 3,
    flexGrow: 0,
    flexShrink: 0,
  },
  center: {
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 5,
    height: '100%',
    // justifyContent: 'space-evenly',
    // height: 48,
    // backgroundColor: 'rgba(0, 0, 0, .1)',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 5,
    paddingRight: 5,
  },
  // row: {
  //   flexDirection: 'row',
  //   flexGrow: 0,
  //   flexShrink: 0,
  // },
})

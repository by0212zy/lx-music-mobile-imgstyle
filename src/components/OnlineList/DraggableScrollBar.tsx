import { memo, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { View, PanResponder, type NativeScrollEvent, type NativeSyntheticEvent, type FlatList } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

interface Props {
  listRef: React.RefObject<FlatList<any>>
  // 每行高度
  itemHeight: number
  // 每行数量（列数）
  columns: number
  // 数据条数
  count: number
}

export interface DraggableScrollBarType {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
}

// 可拖动滚动指示条：替代系统默认过小的滚动条，可用手指拖动快速滚动长列表
const DraggableScrollBar = memo(forwardRef<DraggableScrollBarType, Props>(({ listRef, itemHeight, columns, count }, ref) => {
  const theme = useTheme()
  const containerRef = useRef<View>(null)
  const [trackHeight, setTrackHeight] = useState(0)
  const [progress, setProgress] = useState(0) // 0~1 当前滚动位置比例
  const draggingRef = useRef(false)
  // 记录真实的滚动范围（含 header/footer），拖动时精确按此定位
  const scrollRangeRef = useRef(0)

  const rowCount = count > 0 && columns > 0 ? Math.ceil(count / columns) : 0
  const contentHeight = rowCount * itemHeight

  // 滑块高度比例 = 可视高度 / 内容高度；内容不足一屏时占满
  const thumbRatio = useMemo(() => {
    if (contentHeight <= 0 || trackHeight <= 0) return 1
    return Math.min(1, Math.max(0.08, trackHeight / contentHeight))
  }, [contentHeight, trackHeight])
  const thumbHeight = Math.max(44, trackHeight * thumbRatio)
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = progress * maxThumbTop

  const scrollToProgress = (p: number) => {
    const clamped = Math.min(1, Math.max(0, p))
    setProgress(clamped)
    const range = scrollRangeRef.current > 0
      ? scrollRangeRef.current
      : Math.max(0, contentHeight - trackHeight)
    const targetOffset = clamped * range
    listRef.current?.scrollToOffset({ offset: targetOffset, animated: false })
  }

  useImperativeHandle(ref, () => ({
    onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
      const scrollRange = Math.max(0, contentSize.height - layoutMeasurement.height)
      scrollRangeRef.current = scrollRange
      if (draggingRef.current) return
      setProgress(scrollRange > 0 ? Math.min(1, Math.max(0, contentOffset.y / scrollRange)) : 0)
    },
  }))

  const dragToY = (pageY: number) => {
    containerRef.current?.measure((_x, _y, _w, height, _pageX, pageY0) => {
      if (height <= 0) return
      // 以滑块中心对准手指位置
      const localY = pageY - pageY0 - thumbHeight / 2
      scrollToProgress(localY / Math.max(1, height - thumbHeight))
    })
  }

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      draggingRef.current = true
      dragToY(evt.nativeEvent.pageY)
    },
    onPanResponderMove: (evt) => {
      dragToY(evt.nativeEvent.pageY)
    },
    onPanResponderRelease: () => {
      draggingRef.current = false
    },
    onPanResponderTerminate: () => {
      draggingRef.current = false
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [thumbHeight, contentHeight, trackHeight])

  if (count <= 0) return null

  return (
    <View
      ref={containerRef}
      style={styles.track}
      onLayout={e => { setTrackHeight(e.nativeEvent.layout.height) }}
      collapsable={false}
    >
      <View
        style={{
          ...styles.thumb,
          height: thumbHeight,
          top: thumbTop,
          backgroundColor: theme['c-primary'],
        }}
        {...panResponder.panHandlers}
      />
    </View>
  )
}))

const styles = createStyle({
  track: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 30,
    zIndex: 10,
  },
  thumb: {
    position: 'absolute',
    right: 5,
    width: 14,
    borderRadius: 7,
    opacity: 0.92,
  },
})

export default DraggableScrollBar

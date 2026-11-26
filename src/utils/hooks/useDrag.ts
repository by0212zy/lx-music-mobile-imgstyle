import { useCallback, useRef } from 'react'
import { type LayoutChangeEvent } from 'react-native'

export const useDrag = (onSetProgress: (progress: number) => void, onDragState: (drag: boolean) => void, setDragProgress: (progress: number) => void, onTap?: () => void) => {
  const info = useRef({
    isDraging: false,
    moved: false,
    dragStartX: 0,
    dragStartProgress: 0,
    dragProgress: 0,
    progressWidth: 0,
  })

  const onDragStart = useCallback((offsetX: number, locationX: number) => {
    info.current.isDraging = true
    info.current.moved = false
    info.current.dragStartX = offsetX

    let val = locationX / info.current.progressWidth
    if (val < 0) val = 0
    if (val > 1) val = 1

    setDragProgress(info.current.dragStartProgress = info.current.dragProgress = val)
    // dragProgress.value = msEvent.msDownProgress = val
    onDragState(true)
  }, [onDragState, setDragProgress])
  const onDragEnd = useCallback(() => {
    if (info.current.isDraging) {
      // 未发生实质位移时视为「点击」：交由 onTap 处理（如进入播放页），不 seek
      if (info.current.moved || !onTap) onSetProgress(info.current.dragProgress)
      else onTap()
    }
    info.current.isDraging = false
    onDragState(false)
  }, [onDragState, onSetProgress, onTap])
  const onDrag = useCallback((offsetX: number) => {
    if (!info.current.isDraging) return
    // dragging.value ||= true

    if (Math.abs(offsetX - info.current.dragStartX) > 3) info.current.moved = true
    let progress = info.current.dragStartProgress + (offsetX - info.current.dragStartX) / info.current.progressWidth
    if (progress > 1) progress = 1
    else if (progress < 0) progress = 0
    setDragProgress(info.current.dragProgress = progress)
  }, [setDragProgress])

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    info.current.progressWidth = e.nativeEvent.layout.width
  }, [])

  // const onPress = useCallback((locationX: number) => {
  //   onSetProgress(locationX / info.current.progressWidth)
  // }, [onSetProgress])

  return {
    onLayout,
    onDragStart,
    onDragEnd,
    onDrag,
  }
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, TouchableOpacity, StatusBar as RNStatusBar, type LayoutChangeEvent } from 'react-native'
import PagerView, {
  type PagerViewOnPageSelectedEvent,
  type PageScrollStateChangedNativeEvent,
} from 'react-native-pager-view'

import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useStatusbarHeight } from '@/store/common/hook'
import { useSettingValue } from '@/store/setting/hook'
import { usePlayerMusicInfo, useIsPlay } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import { useLrcPlay, useLrcSet } from '@/plugins/lyric'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { createStyle } from '@/utils/tools'

// 图片样式：独立歌词阅读页
// - 左右滑动翻页（前哨兵=上一首，后哨兵=下一首）
// - 切歌用 key 重建 PagerView + initialPage 一次性定位，彻底规避 setPage 回弹
// - 播放推进到当前停留页后自动跟随；用户手动滑到别页则暂停跟随

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const SENTINEL = 1
const NAV_LOCK_MS = 450
// 用户拖拽后多久内的 pageSelected 视为真实手势；程序 setPage 不产生 dragging
const USER_DRAG_WINDOW = 1200
// 切歌等待新歌词就绪的最长时间（超时后兜底定位到首页，绝不用旧歌词分页）
const SWITCH_WAIT_MS = 5000

interface SlideLine {
  index: number
  text: string
  visualLines: number
}
interface Slide {
  key: string
  sentinel?: 'prev' | 'next'
  start: number
  lines: SlideLine[]
}
interface PendingSwitch {
  dir: 'prev' | 'next'
  fromMusicId: string | null
  baseLines: unknown
  startedAt: number
}

export default memo(() => {
  const musicInfo = usePlayerMusicInfo()
  const isPlay = useIsPlay()
  const lyricLines = useLrcSet()
  const { line: playLine } = useLrcPlay()
  const { width, height } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const fontWeight = useSettingValue('playDetail.lyricFontWeight') ?? 800
  const lineSpacing = useSettingValue('playDetail.lyricLineSpacing') ?? 10
  const wrapLineSpacingRaw = useSettingValue('playDetail.lyricWrapLineSpacing') ?? 5
  const wrapLineSpacing = Math.min(wrapLineSpacingRaw, lineSpacing)
  const bottomBlankLines = useSettingValue('playDetail.lyricBottomBlankLines') ?? 0
  const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize') ?? 210
  const fontSize = lrcFontSize / 10

  const [contentHeight, setContentHeight] = useState(Math.max(240, height - statusBarHeight - 58 - 100))
  const baseLineHeight = Math.max(20, Math.round(fontSize * 1.3))
  const textLineHeight = baseLineHeight + wrapLineSpacing
  const rowGap = Math.max(0, lineSpacing - wrapLineSpacing)
  const maxContentHeight = Math.max(textLineHeight, contentHeight - bottomBlankLines * (textLineHeight + rowGap))
  const charsPerLine = Math.max(6, Math.floor((width - 60) / Math.max(1, fontSize)))

  const handlePagerLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const nextHeight = nativeEvent.layout.height
    if (Math.abs(nextHeight - contentHeight) > 1) setContentHeight(nextHeight)
  }, [contentHeight])

  const realPages = useMemo(() => {
    const result: Array<{ start: number, lines: SlideLine[] }> = []
    let current: { start: number, lines: SlideLine[] } | null = null
    let usedHeight = 0
    for (let i = 0; i < lyricLines.length; i++) {
      const text = lyricLines[i]?.text ?? ''
      const visualLines = Math.max(1, Math.ceil(text.length / charsPerLine))
      const rowHeight = visualLines * textLineHeight + rowGap
      if (!current || usedHeight + rowHeight > maxContentHeight) {
        current = { start: i, lines: [] }
        result.push(current)
        usedHeight = 0
      }
      current.lines.push({ index: i, text, visualLines })
      usedHeight += rowHeight
    }
    if (!result.length) result.push({ start: 0, lines: [] })
    return result
  }, [lyricLines, maxContentHeight, charsPerLine, textLineHeight, rowGap])

  const realPageCount = realPages.length

  const slides = useMemo<Slide[]>(() => [
    { key: 'prev', sentinel: 'prev', start: 0, lines: [] },
    ...realPages.map((p, i) => ({ key: `p${i}`, start: p.start, lines: p.lines })),
    { key: 'next', sentinel: 'next', start: 0, lines: [] },
  ], [realPages])

  const pageForLine = useCallback((line: number) => {
    const idx = clamp(line, 0, Math.max(0, lyricLines.length - 1))
    for (let i = 0; i < realPages.length; i++) {
      const p = realPages[i]
      if (idx >= p.start && idx < p.start + p.lines.length) return i
    }
    return 0
  }, [realPages, lyricLines.length])

  const pagerRef = useRef<PagerView>(null)
  const pageRef = useRef(0)
  const syncModeRef = useRef(true)
  const dragAtRef = useRef(0)
  const navLockRef = useRef(false)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSwitchRef = useRef<PendingSwitch | null>(null)
  // 切歌定位锚定：prev 切到末页后，播放进度往往被播放器归零（playLine=0），
  // 若不锚定，自动跟随会把页面从末页拉回第一页。锚定直到播放进度追上锚定页或用户主动操作。
  const anchorRef = useRef(false)
  const playLineRef = useRef(playLine)
  playLineRef.current = playLine

  // PagerView 通过 key 重建：切歌/首装定位时改 key + initialPage，一次性到位，无回弹
  const [pagerKey, setPagerKey] = useState(0)
  const [initialPage, setInitialPage] = useState(SENTINEL)

  const [page, setPage] = useState(0)
  const [selectedLine, setSelectedLine] = useState<number | null>(null)

  const lockNav = useCallback(() => {
    navLockRef.current = true
    if (navTimerRef.current) clearTimeout(navTimerRef.current)
    navTimerRef.current = setTimeout(() => {
      navLockRef.current = false
    }, NAV_LOCK_MS)
  }, [])

  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current)
  }, [])

  const highlightLine = selectedLine ?? (playLine >= 0 ? playLine : 0)

  // 统一切歌请求：记录当前歌曲与歌词基线，等 musicId 变化后再定位
  const requestSwitch = useCallback((direction: 'prev' | 'next') => {
    if (pendingSwitchRef.current) return
    if (navLockRef.current) return
    lockNav()
    pendingSwitchRef.current = {
      dir: direction,
      fromMusicId: musicInfo.id,
      baseLines: lyricLines,
      startedAt: Date.now(),
    }
    if (direction === 'prev') void playPrev()
    else void playNext()
  }, [lockNav, musicInfo.id, lyricLines])

  // 记录用户真实拖拽：程序 setPage / key 重建不产生 dragging 状态，据此排除程序性事件
  const handleScrollStateChanged = useCallback(({ nativeEvent }: PageScrollStateChangedNativeEvent) => {
    if (nativeEvent.pageScrollState === 'dragging') dragAtRef.current = Date.now()
  }, [])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    if (pendingSwitchRef.current) return
    if (navLockRef.current) return
    const isUserDrag = Date.now() - dragAtRef.current < USER_DRAG_WINDOW
    const position = nativeEvent.position
    const slide = slides[position]
    if (!slide) return

    if (slide.sentinel) {
      // 仅用户真实手势滑到哨兵页才切歌；程序性事件（children 变化/重建）一律忽略
      if (isUserDrag) requestSwitch(slide.sentinel)
      dragAtRef.current = 0
      return
    }

    const realPage = clamp(position - SENTINEL, 0, Math.max(0, realPageCount - 1))
    pageRef.current = realPage
    setPage(realPage)
    setSelectedLine(null)
    if (isUserDrag) {
      anchorRef.current = false
      syncModeRef.current = realPage === pageForLine(playLineRef.current)
      dragAtRef.current = 0
    }
  }, [slides, realPageCount, pageForLine, requestSwitch])

  // 播放进度变化自动跟随（仅在同步模式、无切歌事务时）
  useEffect(() => {
    if (pendingSwitchRef.current) return
    if (navLockRef.current) return
    const target = pageForLine(playLine)
    if (anchorRef.current) {
      // 锚定中：只有播放进度真正推进到锚定页，才解除锚定恢复跟随；
      // 否则忽略 playLine（切歌后它常被播放器重置为 0，在首页），页面稳稳停在锚定页。
      if (target === pageRef.current) anchorRef.current = false
      else return
    }
    if (!syncModeRef.current) {
      if (target === pageRef.current) syncModeRef.current = true
      return
    }
    if (target === pageRef.current) return
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
  }, [playLine, pageForLine])

  // 首次装载：歌词就绪后重建 PagerView 定位到当前播放行
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    if (!lyricLines.length) return
    if (pendingSwitchRef.current) return
    didInitRef.current = true
    const target = clamp(pageForLine(playLineRef.current), 0, Math.max(0, realPageCount - 1))
    pageRef.current = target
    setPage(target)
    dragAtRef.current = 0
    setInitialPage(target + SENTINEL)
    setPagerKey(k => k + 1)
  }, [lyricLines, realPageCount, pageForLine])

  // 切歌定位：musicId 变化 + 新歌词就绪后，重建 PagerView 一次性定位
  useEffect(() => {
    const sw = pendingSwitchRef.current
    if (!sw) return
    // playPrev/playNext 异步：musicId 尚未变化时等待
    if (musicInfo.id === sw.fromMusicId) return

    // 关键：歌词是异步加载的（网络延迟）。切歌时序：
    //   1) setMusicInfo(id=新歌, lrc=null)     —— musicInfo.id 立即变，lrc 被清空
    //   2) musicToggled -> stop() -> lyricLines 被清空为 []（引用也变，但内容为空）
    //   3) getLyricInfo().then -> setMusicInfo(lrc=歌词) + lyricUpdated -> lyricLines 变新歌词数组
    // 若仅以 lrc != null 判断就绪，会出现「lrc 已变、lyricLines 仍是清空后的空数组」的中间态，
    // 此时 realPageCount 只有 1 页，prev 会被误定位到首页。
    // 因此要求歌词行真正到位（有内容），或明确无歌词（lrc === ''），再计算末页。
    const linesRefreshed = lyricLines !== sw.baseLines
    const lyricReady = linesRefreshed && (lyricLines.length > 0 || musicInfo.lrc === '')
    const timedOut = Date.now() - sw.startedAt > SWITCH_WAIT_MS
    if (!lyricReady && !timedOut) return

    // 此刻 realPages/realPageCount 已基于新歌歌词计算；prev 定位末页，next 定位首页
    const target = sw.dir === 'prev' ? Math.max(0, realPageCount - 1) : 0
    if (sw.dir === 'prev') {
      const lineIndex = clamp(realPages[target]?.start ?? 0, 0, Math.max(0, lyricLines.length - 1))
      global.app_event.setProgress((lyricLines[lineIndex]?.time ?? 0) / 1000)
    }

    pendingSwitchRef.current = null
    didInitRef.current = true
    syncModeRef.current = true
    dragAtRef.current = 0
    // prev 定位到末页后必须锚定：切歌会把播放进度重置到开头，playLine 落在首页，
    // 自动跟随会据此把页面拉回第一页。锚定后页面停在末页，直到进度追上或用户操作。
    // next 定位首页与「从头播放」一致，无需锚定。
    anchorRef.current = sw.dir === 'prev'
    setSelectedLine(null)
    pageRef.current = target
    setPage(target)
    setInitialPage(target + SENTINEL)
    setPagerKey(k => k + 1)
  }, [musicInfo.id, musicInfo.lrc, lyricLines, realPageCount, realPages])

  useEffect(() => {
    if (selectedLine != null && selectedLine === playLine) setSelectedLine(null)
  }, [playLine, selectedLine])

  const handleLinePress = useCallback((index: number) => {
    anchorRef.current = false
    syncModeRef.current = true
    setSelectedLine(index)
    const time = lyricLines[index]?.time ?? 0
    global.app_event.setProgress(time / 1000)
  }, [lyricLines])

  const goPage = useCallback((delta: number) => {
    if (navLockRef.current) return
    if (pendingSwitchRef.current) return
    if ((delta > 0 && pageRef.current >= realPageCount - 1) || (delta < 0 && pageRef.current <= 0)) {
      requestSwitch(delta > 0 ? 'next' : 'prev')
      return
    }
    const target = clamp(pageRef.current + delta, 0, Math.max(0, realPageCount - 1))
    if (target === pageRef.current) return
    lockNav()
    anchorRef.current = false
    syncModeRef.current = true
    setSelectedLine(null)
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
    const lineIndex = clamp(realPages[target]?.start ?? 0, 0, Math.max(0, lyricLines.length - 1))
    global.app_event.setProgress((lyricLines[lineIndex]?.time ?? 0) / 1000)
  }, [realPages, realPageCount, lyricLines, lockNav, requestSwitch])

  const handleTogglePlay = useCallback(() => {
    togglePlay()
    anchorRef.current = false
    syncModeRef.current = true
    setSelectedLine(null)
    const target = clamp(pageForLine(playLine), 0, Math.max(0, realPageCount - 1))
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
  }, [pageForLine, playLine, realPageCount])

  const renderPage = (slide: Slide) => (
    <View style={{ ...styles.page, height: contentHeight }} collapsable={false} key={slide.key}>
      {
        slide.sentinel
          ? <Text size={16} color="#8E86A8" style={styles.emptyText}>{slide.sentinel === 'prev' ? '滑动切换上一首' : '滑动切换下一首'}</Text>
          : slide.lines.length
            ? slide.lines.map(({ index, text }) => {
              const active = index === highlightLine
              return (
                <TouchableOpacity
                  style={{ ...styles.lineRow, marginBottom: rowGap }}
                  activeOpacity={0.7}
                  key={index}
                  onPress={() => { handleLinePress(index) }}
                >
                  {/* 标识符用行容器左边框实现，高度天然等于整段文字含任意折行，直角不圆角 */}
                  <View style={active ? styles.activeBar : styles.inactiveBar}>
                    <Text
                      size={fontSize}
                      style={{
                        ...styles.lineText,
                        lineHeight: textLineHeight,
                        color: active ? '#FFB300' : '#EDEAF5',
                        fontWeight: String(fontWeight) as 'normal' | 'bold' | '400' | '500' | '600' | '700' | '800' | '900',
                      }}
                    >{text}</Text>
                  </View>
                </TouchableOpacity>
              )
            })
            : <Text size={16} color="#8E86A8" style={styles.emptyText}>暂无歌词</Text>
      }
    </View>
  )

  return (
    <PageContent>
      <View style={styles.container}>
        <RNStatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        <View style={{ paddingTop: statusBarHeight }}>
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Text size={15} color="#FFFFFF" numberOfLines={1} style={styles.headerTitleText}>{musicInfo.name}</Text>
              <Text size={11} color="#9E96B5" numberOfLines={1} style={styles.headerTitleText}>{musicInfo.singer}</Text>
            </View>
          </View>
        </View>

        <PagerView
          key={pagerKey}
          ref={pagerRef}
          initialPage={initialPage}
          onPageSelected={handlePageSelected}
          onPageScrollStateChanged={handleScrollStateChanged}
          onLayout={handlePagerLayout}
          style={styles.pager}
        >
          {slides.map(renderPage)}
        </PagerView>

        <View style={styles.footer}>
          <Text size={12} color="#8E86A8" style={styles.pageIndicator}>{page + 1} / {realPageCount}</Text>
          <View style={styles.controls}>
            <TouchableOpacity
              style={{ ...styles.sideBtn, borderColor: '#A05CFF' }}
              activeOpacity={0.6}
              onPress={() => { goPage(-1) }}
            >
              <Icon name="chevron-left" color="#C08CFF" size={26} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.playBtn} activeOpacity={0.7} onPress={handleTogglePlay}>
              <Icon name={isPlay ? 'pause' : 'play'} color="#FFFFFF" size={19} />
              <Text size={15} color="#FFFFFF" style={styles.playLabel}>{isPlay ? '暂停' : '播放'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ ...styles.sideBtn, borderColor: '#22C1E8' }}
              activeOpacity={0.6}
              onPress={() => { goPage(1) }}
            >
              <Icon name="chevron-right" color="#6FD8F5" size={26} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </PageContent>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    backgroundColor: '#151024',
  },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerTitle: {
    flex: 1,
    justifyContent: 'center',
  },
  headerTitleText: {
    textAlign: 'left',
  },
  pager: {
    flex: 1,
  },
  page: {
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  activeBar: {
    borderLeftWidth: 7,
    borderLeftColor: '#FFB300',
    paddingLeft: 8,
    flexShrink: 1,
  },
  inactiveBar: {
    borderLeftWidth: 7,
    borderLeftColor: 'transparent',
    paddingLeft: 8,
    flexShrink: 1,
  },
  lineText: {
    fontWeight: '700',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 60,
  },
  footer: {
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: '#1B1530',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  pageIndicator: {
    textAlign: 'center',
    marginBottom: 12,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingHorizontal: 16,
  },
  sideBtn: {
    width: 64,
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    minWidth: 150,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#FFB300',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playLabel: {
    fontWeight: '700',
  },
})

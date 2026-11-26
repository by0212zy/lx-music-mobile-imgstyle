import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, TouchableOpacity, StatusBar as RNStatusBar, type LayoutChangeEvent } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'

import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useStatusbarHeight } from '@/store/common/hook'
import { useSettingValue } from '@/store/setting/hook'
import { usePlayerMusicInfo, useIsPlay } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import { useLrcPlay, useLrcSet } from '@/plugins/lyric'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { pop } from '@/navigation'
import { createStyle } from '@/utils/tools'

// 图片样式：独立歌词阅读页
// 1. 点击歌词跳转到对应播放进度
// 2. 底部按钮翻页并同步播放进度
// 3. 左右滑动只翻页，不同步播放进度；边界滑动切上一首/下一首
// 4. 播放推进到当前停留页后恢复自动跟随

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
// 前后各放一个哨兵页：滑到上一首 / 下一首
const SENTINEL = 1

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

export default memo(({ componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo()
  const isPlay = useIsPlay()
  const lyricLines = useLrcSet()
  const { line: playLine } = useLrcPlay()
  const { width, height } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const fontWeight = useSettingValue('playDetail.lyricFontWeight') ?? 800
  const lineSpacing = useSettingValue('playDetail.lyricLineSpacing') ?? 10
  const bottomBlankLines = useSettingValue('playDetail.lyricBottomBlankLines') ?? 0
  // 字号设置生效：设置项单位为 0.1px（默认 210 = 21px）
  const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize') ?? 210
  const fontSize = lrcFontSize / 10

  // 实际可用高度由布局测量得到，行数随屏幕、字号与行间距自适应，避免底部空白
  const [contentHeight, setContentHeight] = useState(Math.max(240, height - statusBarHeight - 58 - 100))
  // 单个可视行高，换行后的行与设置的行间距保持一致
  const lineUnitHeight = Math.max(26, Math.round(fontSize * 1.3) + lineSpacing)
  // 底部保留 N 行空白：可用行数减少对应行数
  const linesPerPage = clamp(Math.floor(contentHeight / lineUnitHeight) - bottomBlankLines, 1, 40)
  // 估算每行可容纳的字符数（中文按字号宽度近似），用于把折行计入分页
  const charsPerLine = Math.max(6, Math.floor((width - 60) / Math.max(1, fontSize)))

  const handlePagerLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const nextHeight = nativeEvent.layout.height
    if (Math.abs(nextHeight - contentHeight) > 1) setContentHeight(nextHeight)
  }, [contentHeight])

  // 分页按「可视行」累计：一句歌词换行后占多行，也要计入，避免被底部控制栏遮挡
  const realPages = useMemo(() => {
    const result: Array<{ start: number, lines: SlideLine[] }> = []
    let current: { start: number, lines: SlideLine[] } | null = null
    let usedLines = 0
    for (let i = 0; i < lyricLines.length; i++) {
      const text = lyricLines[i]?.text ?? ''
      const visualLines = Math.max(1, Math.ceil(text.length / charsPerLine))
      if (!current || usedLines + visualLines > linesPerPage) {
        current = { start: i, lines: [] }
        result.push(current)
        usedLines = 0
      }
      current.lines.push({ index: i, text, visualLines })
      usedLines += visualLines
    }
    if (!result.length) result.push({ start: 0, lines: [] })
    return result
  }, [lyricLines, linesPerPage, charsPerLine])

  const realPageCount = realPages.length

  // 前后哨兵页 + 真实歌词页
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
  const programmaticRef = useRef(false)
  const firstPageEventRef = useRef(true)
  const syncModeRef = useRef(true)
  // 标记本次切歌是否为「切上一首」，用于定位到上一首最后一页
  const pendingPrevRef = useRef(false)
  // 翻页动画锁：快速连续点击时忽略后续请求，避免来回乱跳
  const navLockRef = useRef(false)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [page, setPage] = useState(0)

  const lockNav = useCallback(() => {
    navLockRef.current = true
    if (navTimerRef.current) clearTimeout(navTimerRef.current)
    navTimerRef.current = setTimeout(() => {
      navLockRef.current = false
    }, 450)
  }, [])

  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current)
  }, [])
  const [selectedLine, setSelectedLine] = useState<number | null>(null)

  const highlightLine = selectedLine ?? (playLine >= 0 ? playLine : 0)

  const close = useCallback(() => {
    void pop(componentId)
  }, [componentId])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const position = nativeEvent.position
    if (firstPageEventRef.current) {
      firstPageEventRef.current = false
      programmaticRef.current = false
      return
    }
    // 滑到前哨兵页 -> 上一首
    if (position === 0) {
      if (navLockRef.current) return
      lockNav()
      pendingPrevRef.current = true
      void playPrev()
      return
    }
    // 滑到后哨兵页 -> 下一首
    if (position === realPageCount + 1) {
      if (navLockRef.current) return
      lockNav()
      void playNext()
      return
    }
    const realPage = position - SENTINEL
    pageRef.current = realPage
    setPage(realPage)
    setSelectedLine(null)
    if (programmaticRef.current) {
      programmaticRef.current = false
      return
    }
    // 用户左右滑动：仅翻页，不同步播放进度
    // 若滑到当前播放歌词所在页，则恢复自动跟随；不在当前播放页则保持不跟随
    const playingPage = pageForLine(playLine)
    syncModeRef.current = realPage === playingPage
  }, [playLine, pageForLine, realPageCount, lockNav])

  // 播放进度变化时自动翻页
  useEffect(() => {
    if (pendingPrevRef.current || navLockRef.current) return
    const target = pageForLine(playLine)
    if (!syncModeRef.current) {
      // 播放已推进到用户当前停留的页 -> 恢复自动跟随（需求3）
      if (target === pageRef.current) syncModeRef.current = true
      return
    }
    if (target === pageRef.current) return
    programmaticRef.current = true
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
  }, [playLine, pageForLine])

  // 切歌后回到同步模式
  useEffect(() => {
    if (!lyricLines.length) return
    syncModeRef.current = true
    setSelectedLine(null)
    let target: number
    if (pendingPrevRef.current) {
      // 切上一首：定位并跳转到上一首最后一页的歌词进度，而不是从开头
      pendingPrevRef.current = false
      target = realPageCount - 1
      const lineIndex = realPages[target]?.start ?? 0
      const time = lyricLines[lineIndex]?.time ?? 0
      global.app_event.setProgress(time / 1000)
    } else {
      target = clamp(pageForLine(playLine), 0, realPageCount - 1)
    }
    pageRef.current = target
    setPage(target)
    programmaticRef.current = true
    pagerRef.current?.setPage(target + SENTINEL)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricLines, musicInfo.id])

  useEffect(() => {
    if (selectedLine != null && selectedLine === playLine) setSelectedLine(null)
  }, [playLine, selectedLine])

  // 1. 点击歌词文字 -> 跳转到该行进度
  const handleLinePress = useCallback((index: number) => {
    syncModeRef.current = true
    setSelectedLine(index)
    const time = lyricLines[index]?.time ?? 0
    global.app_event.setProgress(time / 1000)
  }, [lyricLines])

  // 2. 底部按钮翻页 -> 同步播放进度；在边界继续翻则切歌
  const goPage = useCallback((delta: number) => {
    if (navLockRef.current) return
    // 边界继续翻：下一首 / 上一首
    if ((delta > 0 && pageRef.current >= realPageCount - 1) || (delta < 0 && pageRef.current <= 0)) {
      lockNav()
      if (delta > 0) {
        void playNext()
      } else {
        pendingPrevRef.current = true
        void playPrev()
      }
      return
    }
    const target = clamp(pageRef.current + delta, 0, realPageCount - 1)
    if (target === pageRef.current) return
    lockNav()
    syncModeRef.current = true
    setSelectedLine(null)
    programmaticRef.current = true
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
    const lineIndex = clamp(realPages[target].start, 0, lyricLines.length - 1)
    global.app_event.setProgress((lyricLines[lineIndex]?.time ?? 0) / 1000)
  }, [realPages, realPageCount, lyricLines, lockNav])

  // 播放/暂停时重新定位到当前播放歌词行
  const handleTogglePlay = useCallback(() => {
    togglePlay()
    syncModeRef.current = true
    setSelectedLine(null)
    const target = clamp(pageForLine(playLine), 0, realPageCount - 1)
    programmaticRef.current = true
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
            ? slide.lines.map(({ index, text, visualLines }) => {
              const active = index === highlightLine
              return (
                <TouchableOpacity
                  style={{ ...styles.lineRow, minHeight: visualLines * lineUnitHeight }}
                  activeOpacity={0.7}
                  key={index}
                  onPress={() => { handleLinePress(index) }}
                >
                  <View style={active ? styles.activeBar : styles.inactiveBar} />
                  <Text
                    size={fontSize}
                    style={{
                      ...styles.lineText,
                      lineHeight: lineUnitHeight,
                      color: active ? '#FFB300' : '#EDEAF5',
                      fontWeight: String(fontWeight) as 'normal' | 'bold' | '400' | '500' | '600' | '700' | '800' | '900',
                    }}
                  >{text}</Text>
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
            <TouchableOpacity style={styles.closeBtn} activeOpacity={0.6} onPress={close}>
              <Icon name="close" color="#FFFFFF" size={20} />
            </TouchableOpacity>
            <View style={styles.readingBadge}>
              <Text size={12} color="#FFFFFF">阅读中</Text>
            </View>
            <View style={styles.headerTitle}>
              <Text size={15} color="#FFFFFF" numberOfLines={1}>{musicInfo.name}</Text>
              <Text size={11} color="#9E96B5" numberOfLines={1}>{musicInfo.singer}</Text>
            </View>
          </View>
        </View>

        <PagerView
          ref={pagerRef}
          initialPage={SENTINEL}
          onPageSelected={handlePageSelected}
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
    gap: 10,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  readingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#5B8DEF',
  },
  headerTitle: {
    flex: 1,
    justifyContent: 'center',
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
    alignItems: 'center',
    paddingVertical: 2,
  },
  activeBar: {
    width: 3,
    height: 22,
    borderRadius: 2,
    backgroundColor: '#FFB300',
    marginRight: 12,
  },
  inactiveBar: {
    width: 3,
    marginRight: 12,
  },
  lineText: {
    fontWeight: '700',
    flexShrink: 1,
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

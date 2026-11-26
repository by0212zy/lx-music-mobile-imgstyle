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
// 切歌后 PagerView children 数量变化会引发回弹/越界事件，锁定期内一律忽略切歌
const SWITCH_LOCK_MS = 1200

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
  // 折行行距：默认取段落行距的一半，可单独设置（不超过段距）
  const wrapLineSpacingRaw = useSettingValue('playDetail.lyricWrapLineSpacing') ?? 5
  const wrapLineSpacing = Math.min(wrapLineSpacingRaw, lineSpacing)
  const bottomBlankLines = useSettingValue('playDetail.lyricBottomBlankLines') ?? 0
  // 字号设置生效：设置项单位为 0.1px（默认 210 = 21px）
  const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize') ?? 210
  const fontSize = lrcFontSize / 10

  // 实际可用高度由布局测量得到，行数随屏幕、字号与行间距自适应，避免底部空白
  const [contentHeight, setContentHeight] = useState(Math.max(240, height - statusBarHeight - 58 - 100))
  // 单个可视行的基础行高；折行之间用较小的 wrapLineSpacing，段与段之间用 lineSpacing
  const baseLineHeight = Math.max(20, Math.round(fontSize * 1.3))
  const textLineHeight = baseLineHeight + wrapLineSpacing
  const rowGap = Math.max(0, lineSpacing - wrapLineSpacing)
  const maxContentHeight = Math.max(textLineHeight, contentHeight - bottomBlankLines * (textLineHeight + rowGap))
  // 估算每行可容纳的字符数（中文按字号宽度近似），用于把折行计入分页
  const charsPerLine = Math.max(6, Math.floor((width - 60) / Math.max(1, fontSize)))

  const handlePagerLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const nextHeight = nativeEvent.layout.height
    if (Math.abs(nextHeight - contentHeight) > 1) setContentHeight(nextHeight)
  }, [contentHeight])

  // 分页按「可视行高度」累计：一句歌词换行后占多行，也要计入，避免被底部控制栏遮挡
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

  // 前后哨兵页 + 真实歌词页
  const slides = useMemo<Slide[]>(() => [
    { key: 'prev', sentinel: 'prev', start: 0, lines: [] },
    ...realPages.map((p, i) => ({ key: `p${i}`, start: p.start, lines: p.lines })),
    { key: 'next', sentinel: 'next', start: 0, lines: [] },
  ], [realPages])

  // 通过 key/sentinel 判断页面类型，而非依赖会随 children 数量变化的 position 数字
  const slideAt = useCallback((position: number): Slide | undefined => slides[position], [slides])

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
  // 切上一首：定位到上一首最后一页
  const pendingPrevRef = useRef(false)
  // 切歌锁：切歌发起后到 children 稳定前，忽略所有 onPageSelected 的切歌判定
  // 用截止时间戳而非布尔，覆盖 PagerView 异步回弹的完整窗口
  const switchLockUntilRef = useRef(0)
  // 翻页动画锁：快速连续点击时忽略后续请求，避免来回乱跳
  const navLockRef = useRef(false)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [page, setPage] = useState(0)

  const isSwitchLocked = useCallback(() => Date.now() < switchLockUntilRef.current, [])
  const lockSwitch = useCallback(() => {
    switchLockUntilRef.current = Date.now() + SWITCH_LOCK_MS
  }, [])

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

  // 统一的切歌请求：先锁定，再把页面停在安全真实页，最后发起切歌
  const requestSwitch = useCallback((direction: 'prev' | 'next') => {
    lockNav()
    lockSwitch()
    // 立刻离开哨兵页，避免 children 变化时 clamped 到另一侧哨兵而触发反向切歌
    const safePage = clamp(pageRef.current, 0, Math.max(0, realPageCount - 1))
    programmaticRef.current = true
    pageRef.current = safePage
    setPage(safePage)
    pagerRef.current?.setPage(safePage + SENTINEL)
    if (direction === 'prev') {
      pendingPrevRef.current = true
      void playPrev()
    } else {
      pendingPrevRef.current = false
      void playNext()
    }
  }, [lockNav, lockSwitch, realPageCount])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const position = nativeEvent.position
    if (firstPageEventRef.current) {
      firstPageEventRef.current = false
      programmaticRef.current = false
      return
    }
    // 程序性翻页（自动跟随 / 底部按钮 / 切歌定位）：只同步页码显示，绝不触发切歌
    if (programmaticRef.current) {
      programmaticRef.current = false
      const slide = slideAt(position)
      if (slide && !slide.sentinel) {
        const realPage = clamp(position - SENTINEL, 0, Math.max(0, realPageCount - 1))
        pageRef.current = realPage
        setPage(realPage)
      }
      return
    }
    // 切歌锁定期内：children 变化引发的回弹/越界事件一律忽略
    if (isSwitchLocked()) return
    const slide = slideAt(position)
    // 用 sentinel 属性判断，而非 position 数字
    if (slide?.sentinel === 'prev') {
      if (navLockRef.current) return
      requestSwitch('prev')
      return
    }
    if (slide?.sentinel === 'next') {
      if (navLockRef.current) return
      requestSwitch('next')
      return
    }
    const realPage = clamp(position - SENTINEL, 0, Math.max(0, realPageCount - 1))
    pageRef.current = realPage
    setPage(realPage)
    setSelectedLine(null)
    // 用户左右滑动：仅翻页，不同步播放进度
    // 若滑到当前播放歌词所在页，则恢复自动跟随；不在当前播放页则保持不跟随
    const playingPage = pageForLine(playLine)
    syncModeRef.current = realPage === playingPage
  }, [slideAt, realPageCount, isSwitchLocked, requestSwitch, pageForLine, playLine])

  // 播放进度变化时自动翻页
  useEffect(() => {
    if (pendingPrevRef.current || navLockRef.current || isSwitchLocked()) return
    const target = pageForLine(playLine)
    if (!syncModeRef.current) {
      // 播放已推进到用户当前停留的页 -> 恢复自动跟随
      if (target === pageRef.current) syncModeRef.current = true
      return
    }
    if (target === pageRef.current) return
    programmaticRef.current = true
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
  }, [playLine, pageForLine, isSwitchLocked])

  // 切歌后回到同步模式并定位
  useEffect(() => {
    if (!lyricLines.length) return
    // 歌词可能异步二次加载并再次改变 children 数量，这里重置锁覆盖后续回弹
    lockSwitch()
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
    if (navLockRef.current || isSwitchLocked()) return
    // 边界继续翻：下一首 / 上一首
    if ((delta > 0 && pageRef.current >= realPageCount - 1) || (delta < 0 && pageRef.current <= 0)) {
      requestSwitch(delta > 0 ? 'next' : 'prev')
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
  }, [realPages, realPageCount, lyricLines, lockNav, isSwitchLocked, requestSwitch])

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
              // 竖条高度精确匹配整段歌词（含折行），不超出文字顶部和底部
              const barHeight = visualLines * textLineHeight
              return (
                <TouchableOpacity
                  style={{ ...styles.lineRow, marginBottom: rowGap }}
                  activeOpacity={0.7}
                  key={index}
                  onPress={() => { handleLinePress(index) }}
                >
                  <View style={{ ...(active ? styles.activeBar : styles.inactiveBar), height: barHeight }} />
                  <Text
                    size={fontSize}
                    style={{
                      ...styles.lineText,
                      lineHeight: textLineHeight,
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
    alignItems: 'flex-start',
  },
  activeBar: {
    width: 7,
    borderRadius: 3,
    backgroundColor: '#FFB300',
    marginRight: 15,
    marginTop: 1,
  },
  inactiveBar: {
    width: 7,
    marginRight: 15,
    marginTop: 1,
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

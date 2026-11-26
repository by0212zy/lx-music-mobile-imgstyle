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
// 用户 dragging 后多久内的 onPageSelected 视为「用户手势」——程序性 setPage 不产生 dragging 状态
const USER_DRAG_WINDOW = 1000
// 底部按钮 / 滑动切歌防抖窗口
const NAV_LOCK_MS = 450

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
interface SwitchTxn {
  dir: 'prev' | 'next'
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
  // 最近一次用户 dragging 的时间戳：程序性 setPage 不产生 dragging，据此区分手势与回弹
  const dragAtRef = useRef(0)
  const navLockRef = useRef(false)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 切歌事务：本页发起的切歌在完全定位前一直有效，期间忽略一切 pageSelected
  const switchTxnRef = useRef<SwitchTxn | null>(null)
  // 定位事务：musicId 变化时创建，等新歌词就绪后一次性定位并清除
  const locateRef = useRef<{
    musicId: string | null
    dir: 'prev' | 'next' | null
    baseLines: unknown
    startedAt: number
  } | null>(null)
  // 用 ref 保存最新 playLine，使回调/effect 读到实时值
  const playLineRef = useRef(playLine)
  playLineRef.current = playLine
  const prevMusicIdRef = useRef(musicInfo.id)

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

  // 检测歌曲切换：musicId 变化时开启定位事务，记录切歌方向作为「基线歌词引用」。
  // 注意：musicId 同步变化，而歌词是异步加载的（getLyricInfo().then → setLyric），
  // 所以此刻的 lyricLines 仍是上一首的旧歌词，必须等它换成新引用才定位。
  if (prevMusicIdRef.current !== musicInfo.id) {
    prevMusicIdRef.current = musicInfo.id
    locateRef.current = {
      musicId: musicInfo.id,
      dir: switchTxnRef.current?.dir ?? null,
      baseLines: lyricLines,
      startedAt: Date.now(),
    }
  }

  const highlightLine = selectedLine ?? (playLine >= 0 ? playLine : 0)

  const close = useCallback(() => {
    void pop(componentId)
  }, [componentId])

  // 统一的切歌请求：开启事务并发起切歌，定位交给下面的「歌曲切换定位」effect 完成
  const requestSwitch = useCallback((direction: 'prev' | 'next') => {
    if (switchTxnRef.current) return
    if (navLockRef.current) return
    lockNav()
    dragAtRef.current = 0
    switchTxnRef.current = { dir: direction }
    if (direction === 'prev') void playPrev()
    else void playNext()
  }, [lockNav])

  // 记录用户拖拽手势：只有 dragging 状态来自真实手指滑动，程序 setPage 不会产生
  const handleScrollStateChanged = useCallback(({ nativeEvent }: PageScrollStateChangedNativeEvent) => {
    if (nativeEvent.pageScrollState === 'dragging') dragAtRef.current = Date.now()
  }, [])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const position = nativeEvent.position
    // 切歌/定位事务进行中：children 变化、setPage 动画、回弹引发的所有事件一律忽略，
    // 杜绝重复切歌与「先跳回旧页再跳目标页」的跳变
    if (switchTxnRef.current) return
    if (locateRef.current) return

    const isUserDrag = Date.now() - dragAtRef.current < USER_DRAG_WINDOW
    const slide = slides[position]

    if (slide?.sentinel) {
      if (isUserDrag && !navLockRef.current) {
        requestSwitch(slide.sentinel)
      } else if (!isUserDrag) {
        // 程序性事件把页面带到哨兵页（children 变化 clamp 等）：拉回当前真实页
        const safe = clamp(pageRef.current, 0, Math.max(0, realPageCount - 1))
        pagerRef.current?.setPage(safe + SENTINEL)
      }
      return
    }

    // 真实页：同步页码显示
    const realPage = clamp(position - SENTINEL, 0, Math.max(0, realPageCount - 1))
    pageRef.current = realPage
    setPage(realPage)
    setSelectedLine(null)
    // 仅用户手动滑动才决定是否跟随；程序性翻页（自动跟随/底部按钮）不改变跟随模式
    if (isUserDrag) {
      syncModeRef.current = realPage === pageForLine(playLineRef.current)
      dragAtRef.current = 0
    }
  }, [slides, realPageCount, pageForLine, requestSwitch])

  // 播放进度变化时自动翻页（定位事务未完成时冻结，避免用旧 playLine 二次翻页造成「歌词跳」）
  useEffect(() => {
    if (locateRef.current) return
    if (switchTxnRef.current) return
    if (navLockRef.current) return
    const target = pageForLine(playLine)
    if (!syncModeRef.current) {
      // 播放已推进到用户当前停留的页 -> 恢复自动跟随
      if (target === pageRef.current) syncModeRef.current = true
      return
    }
    if (target === pageRef.current) return
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
  }, [playLine, pageForLine])

  // 歌曲切换定位：等新歌词就绪后一次性定位，杜绝用旧歌词/旧 playLine 定位导致的跳页
  useEffect(() => {
    const loc = locateRef.current
    if (!loc || loc.musicId !== musicInfo.id) return

    // 歌词是否换成新歌：musicId 变化时会先把 lrc 清空（lyricLines 变成空数组，引用也会变），
    // 不能把这次清空误判为「新歌词就绪」，否则切上一首会用空歌词定位，丢失末页进度。
    // 因此要求：歌词引用变化 且 已有歌词内容；无歌词歌曲靠 3s 兜底完成定位。
    const lyricReady = (lyricLines !== loc.baseLines && lyricLines.length > 0) || Date.now() - loc.startedAt > 3000
    if (!lyricReady) return

    locateRef.current = null
    switchTxnRef.current = null
    dragAtRef.current = 0
    syncModeRef.current = true
    setSelectedLine(null)

    let target: number
    if (loc.dir === 'prev') {
      // 切上一首：定位到最后一页，并把播放进度跳到该页首行，从上一首末尾继续
      target = realPageCount - 1
      const lineIndex = clamp(realPages[target]?.start ?? 0, 0, lyricLines.length - 1)
      global.app_event.setProgress((lyricLines[lineIndex]?.time ?? 0) / 1000)
    } else if (loc.dir === 'next') {
      // 切下一首：定位到第一页，播放进度交给播放器从 0 开始，不再手动 setProgress
      target = 0
    } else {
      // 首次装载 / 外部切歌：定位到当前播放行所在页
      target = clamp(pageForLine(playLineRef.current), 0, realPageCount - 1)
    }
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
  }, [musicInfo.id, lyricLines, realPageCount, realPages, pageForLine])

  // 首次装载：若没有切歌事务且尚未定位过，定位到当前播放行所在页
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current || !lyricLines.length || locateRef.current) return
    didInitRef.current = true
    const target = clamp(pageForLine(playLineRef.current), 0, realPageCount - 1)
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
  }, [lyricLines, realPageCount, pageForLine])

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
    if (switchTxnRef.current) return
    if ((delta > 0 && pageRef.current >= realPageCount - 1) || (delta < 0 && pageRef.current <= 0)) {
      requestSwitch(delta > 0 ? 'next' : 'prev')
      return
    }
    const target = clamp(pageRef.current + delta, 0, realPageCount - 1)
    if (target === pageRef.current) return
    lockNav()
    syncModeRef.current = true
    setSelectedLine(null)
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target + SENTINEL)
    const lineIndex = clamp(realPages[target].start, 0, lyricLines.length - 1)
    global.app_event.setProgress((lyricLines[lineIndex]?.time ?? 0) / 1000)
  }, [realPages, realPageCount, lyricLines, lockNav, requestSwitch])

  // 播放/暂停时重新定位到当前播放歌词行
  const handleTogglePlay = useCallback(() => {
    togglePlay()
    syncModeRef.current = true
    setSelectedLine(null)
    const target = clamp(pageForLine(playLine), 0, realPageCount - 1)
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
                  {/* 竖条用 stretch 自动匹配文字实际渲染高度，折行也能完整覆盖，不超出上下缘 */}
                  <View style={active ? styles.activeBar : styles.inactiveBar} />
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
    alignSelf: 'stretch',
    backgroundColor: '#FFB300',
    marginRight: 15,
  },
  inactiveBar: {
    width: 7,
    alignSelf: 'stretch',
    marginRight: 15,
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

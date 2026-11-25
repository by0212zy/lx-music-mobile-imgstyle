import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, TouchableOpacity, StatusBar as RNStatusBar } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'

import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useStatusbarHeight } from '@/store/common/hook'
import { usePlayerMusicInfo, useIsPlay } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import { type Line, useLrcPlay, useLrcSet } from '@/plugins/lyric'
import { togglePlay } from '@/core/player/player'
import { pop } from '@/navigation'
import { createStyle } from '@/utils/tools'

// 图片样式：独立歌词阅读页
// 1. 点击歌词跳转到对应播放进度
// 2. 底部按钮翻页并同步播放进度
// 3. 左右滑动只翻页，不同步播放进度
// 4. 歌词字体加粗

const LINE_HEIGHT = 56

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default memo(({ componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo()
  const isPlay = useIsPlay()
  const lyricLines = useLrcSet()
  const { line: playLine } = useLrcPlay()
  const { height } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()

  const contentHeight = Math.max(
    240,
    height - statusBarHeight - 102 - 132 - 16,
  )
  const linesPerPage = clamp(Math.floor(contentHeight / LINE_HEIGHT), 4, 20)

  const pages = useMemo(() => {
    const result: Array<{ start: number, lines: Array<{ index: number, text: string }> }> = []
    for (let i = 0; i < lyricLines.length; i += linesPerPage) {
      result.push({
        start: i,
        lines: lyricLines.slice(i, i + linesPerPage).map((l: Line, j: number) => ({
          index: i + j,
          text: l.text,
        })),
      })
    }
    if (!result.length) result.push({ start: 0, lines: [] })
    return result
  }, [lyricLines, linesPerPage])

  const pagerRef = useRef<PagerView>(null)
  const pageRef = useRef(clamp(Math.floor(Math.max(playLine, 0) / linesPerPage), 0, pages.length - 1))
  const programmaticRef = useRef(false)
  const syncModeRef = useRef(true)
  const [page, setPage] = useState(pageRef.current)
  const [selectedLine, setSelectedLine] = useState<number | null>(null)

  const highlightLine = selectedLine ?? (playLine >= 0 ? playLine : 0)

  const close = useCallback(() => {
    void pop(componentId)
  }, [componentId])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const position = nativeEvent.position
    pageRef.current = position
    setPage(position)
    setSelectedLine(null)
    if (programmaticRef.current) {
      programmaticRef.current = false
    } else {
      // 用户左右滑动：仅翻页，不同步播放进度
      syncModeRef.current = false
    }
  }, [])

  // 播放进度变化时自动翻页（仅在同步模式下）
  useEffect(() => {
    if (!syncModeRef.current) return
    const target = clamp(Math.floor(Math.max(playLine, 0) / linesPerPage), 0, pages.length - 1)
    if (target === pageRef.current) return
    programmaticRef.current = true
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target)
  }, [playLine, linesPerPage, pages.length])

  // 切歌后回到同步模式
  useEffect(() => {
    syncModeRef.current = true
    setSelectedLine(null)
    const target = clamp(Math.floor(Math.max(playLine, 0) / linesPerPage), 0, pages.length - 1)
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricLines])

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

  // 2. 底部按钮翻页 -> 同步播放进度
  const goPage = useCallback((delta: number) => {
    const target = clamp(pageRef.current + delta, 0, pages.length - 1)
    if (target === pageRef.current) return
    syncModeRef.current = true
    setSelectedLine(null)
    programmaticRef.current = true
    pageRef.current = target
    setPage(target)
    pagerRef.current?.setPage(target)
    const lineIndex = clamp(pages[target].start, 0, lyricLines.length - 1)
    global.app_event.setProgress((lyricLines[lineIndex]?.time ?? 0) / 1000)
  }, [pages, lyricLines])

  const renderPage = (pageData: { start: number, lines: Array<{ index: number, text: string }> }) => (
    <View style={{ ...styles.page, height: contentHeight }} collapsable={false} key={pageData.start}>
      {
        pageData.lines.length
          ? pageData.lines.map(({ index, text }) => {
            const active = index === highlightLine
            return (
              <TouchableOpacity
                style={styles.lineRow}
                activeOpacity={0.7}
                key={index}
                onPress={() => { handleLinePress(index) }}
              >
                <View style={active ? styles.activeBar : styles.inactiveBar} />
                <Text
                  size={19}
                  numberOfLines={2}
                  style={{ ...styles.lineText, color: active ? '#FFB300' : '#EDEAF5' }}
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
          initialPage={pageRef.current}
          onPageSelected={handlePageSelected}
          style={styles.pager}
        >
          {pages.map(renderPage)}
        </PagerView>

        <View style={styles.footer}>
          <Text size={12} color="#8E86A8" style={styles.pageIndicator}>{page + 1} / {pages.length}</Text>
          <View style={styles.controls}>
            <TouchableOpacity
              style={{ ...styles.sideBtn, borderColor: '#A05CFF' }}
              activeOpacity={0.6}
              onPress={() => { goPage(-1) }}
            >
              <Icon name="chevron-left" color="#C08CFF" size={26} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.playBtn} activeOpacity={0.7} onPress={togglePlay}>
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
    height: LINE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
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
    height: 132,
    paddingBottom: 18,
    justifyContent: 'flex-end',
    backgroundColor: '#1B1530',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  pageIndicator: {
    textAlign: 'center',
    marginBottom: 14,
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

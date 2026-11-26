import { memo, useCallback, useRef } from 'react'
import { View, TouchableOpacity, StatusBar as RNStatusBar } from 'react-native'

import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import ProgressBar from '@/components/player/ProgressBar'
import SettingPopup, { type SettingPopupType } from '../components/SettingPopup'
import TimeoutExitEditModal, { type TimeoutExitEditModalType, useTimeInfo } from '@/components/TimeoutExitEditModal'
import SkipIntroOutroModal, { type SkipIntroOutroModalType } from '@/components/SkipIntroOutroModal'
import { CollectItem, CommentItem, MoreItem, PlayModeItem } from './ImageStyleMoreItems'
import { usePlayerMusicInfo, useProgress, useIsPlay } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { useBufferProgress } from '@/plugins/player'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { navigations, pop, popToRoot } from '@/navigation'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { createStyle } from '@/utils/tools'

// 图片样式：播放页（黑紫渐变 + 唱片封面 + 蓝色主按钮）
export default memo(({ componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo()
  const isPlay = useIsPlay()
  const { nowPlayTime, maxPlayTime, progress, nowPlayTimeStr, maxPlayTimeStr } = useProgress()
  const buffered = useBufferProgress()
  const { width, height } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()

  const settingPopupRef = useRef<SettingPopupType>(null)
  const timeoutModalRef = useRef<TimeoutExitEditModalType>(null)
  const skipModalRef = useRef<SkipIntroOutroModalType>(null)
  const timeInfo = useTimeInfo()
  const playbackRate = useSettingValue('player.playbackRate')

  // 图片样式：封面保持静态，不再旋转
  const discSize = Math.min(width * 0.66, (height - statusBarHeight) * 0.4)
  const subtitle = [musicInfo.singer, (musicInfo as unknown as { album?: string }).album]
    .filter(Boolean)
    .join(' · ')

  const seek = useCallback((delta: number) => {
    const target = Math.min(Math.max(nowPlayTime + delta, 0), maxPlayTime || Infinity)
    global.app_event.setProgress(target)
  }, [nowPlayTime, maxPlayTime])

  const handleBack = () => {
    void pop(componentId)
  }
  const handlePrev = () => {
    void playPrev()
  }
  const handleNext = () => {
    void playNext()
  }
  const handleOpenPlayList = () => {
    void popToRoot(componentId).then(() => {
      global.app_event.jumpListPosition()
    })
  }

  return (
    <View style={styles.container}>
      <RNStatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <View style={{ paddingTop: statusBarHeight }}>
        <View style={styles.header} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_header}>
          <TouchableOpacity style={styles.headerRoundBtn} activeOpacity={0.6} onPress={handleBack}>
            <Icon name="chevron-left" color="#FFFFFF" size={20} />
          </TouchableOpacity>
          <View style={styles.playingBadge}>
            <Text size={12} color="#FFFFFF">正在播放</Text>
          </View>
          <View style={styles.headerSpacer} />
          <TouchableOpacity style={styles.gainBtn} activeOpacity={0.6} onPress={() => settingPopupRef.current?.show()}>
            <Icon name="setting" color="#FFFFFF" size={16} />
            <Text size={12} color="#FFFFFF" style={styles.gainBtnText}>设置</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={styles.discArea}
        activeOpacity={1}
        onPress={() => { navigations.pushLyricScreen(componentId) }}
      >
        <View style={styles.rings}>
          {[1.55, 1.32, 1.14].map((scale, index) => (
            <View
              key={index}
              style={{
                ...styles.ring,
                width: discSize * scale,
                height: discSize * scale,
                borderRadius: discSize * scale / 2,
              }}
            />
          ))}
        </View>
        <View style={{ ...styles.disc, width: discSize, height: discSize, borderRadius: discSize / 2 }}>
          <Image
            url={musicInfo.pic}
            nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic}
            style={{ width: discSize - 10, height: discSize - 10, borderRadius: (discSize - 10) / 2 }}
          />
          <View style={{ ...styles.discHole, width: discSize * 0.055, height: discSize * 0.055, borderRadius: discSize * 0.0275 }} />
        </View>
      </TouchableOpacity>

      <View style={styles.trackInfo}>
        <View style={styles.episodeBadge}>
          <Text size={11} color="#FFFFFF">正在播放</Text>
        </View>
        <Text size={21} color="#FFFFFF" numberOfLines={2} style={styles.trackName}>{musicInfo.name}</Text>
        <Text size={12} color="#A9A2C0" numberOfLines={1}>{subtitle}</Text>
      </View>

      <View style={styles.progressSection}>
        <View style={styles.progressRow}>
          <TouchableOpacity style={styles.seekBtn} activeOpacity={0.6} onPress={() => { seek(-15) }}>
            <Icon name="chevron-left-2" color="#B9B2CC" size={20} />
            <Text size={10} color="#B9B2CC" style={styles.seekBtnLabel}>15</Text>
          </TouchableOpacity>
          <View style={styles.progressWrap}>
            <ProgressBar progress={progress} duration={maxPlayTime} buffered={buffered} />
          </View>
          <TouchableOpacity style={styles.seekBtn} activeOpacity={0.6} onPress={() => { seek(15) }}>
            <Icon name="chevron-right-2" color="#B9B2CC" size={20} />
            <Text size={10} color="#B9B2CC" style={styles.seekBtnLabel}>15</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.timeRow}>
          <Text size={12} color="#B9B2CC">{nowPlayTimeStr}</Text>
          <Text size={12} color="#B9B2CC">{maxPlayTimeStr}</Text>
        </View>
      </View>

      <View style={styles.moreRow}>
        <MoreItem label="倍速" onPress={() => settingPopupRef.current?.show()}>
          <Text size={14} color="#D8D3E8">{playbackRate.toFixed(2).replace(/0$/, '')}x</Text>
        </MoreItem>
        <MoreItem label="定时" onPress={() => timeoutModalRef.current?.show()}>
          <Icon name="music_time" color={timeInfo.active ? '#FFB300' : '#D8D3E8'} size={18} />
        </MoreItem>
        <MoreItem label="跳过" onPress={() => skipModalRef.current?.show()}>
          <Icon name="chevron-right-2" color="#D8D3E8" size={18} />
        </MoreItem>
        <CollectItem />
        <CommentItem />
        <PlayModeItem />
      </View>

      <View style={styles.bottomBar} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_player}>
        <TouchableOpacity style={styles.bookBtn} activeOpacity={0.6} onPress={() => { navigations.pushLyricScreen(componentId) }}>
          <Icon name="lyric-on" color="#C08CFF" size={22} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} activeOpacity={0.6} onPress={handlePrev}>
          <Icon name="prevMusic" color="#D8D3E8" size={26} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mainPlayBtn} activeOpacity={0.7} onPress={togglePlay}>
          <Icon name={isPlay ? 'pause' : 'play'} color="#FFFFFF" size={30} rawSize={30} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideBtn} activeOpacity={0.6} onPress={handleNext}>
          <Icon name="nextMusic" color="#D8D3E8" size={26} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.bookBtn} activeOpacity={0.6} onPress={handleOpenPlayList}>
          <Icon name="menu" color="#C08CFF" size={22} />
        </TouchableOpacity>
      </View>

      <SettingPopup ref={settingPopupRef} direction="vertical" />
      <TimeoutExitEditModal ref={timeoutModalRef} timeInfo={timeInfo} />
      <SkipIntroOutroModal ref={skipModalRef} />
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    backgroundColor: '#140D24',
  },
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerRoundBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  playingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#5B8DEF',
    marginLeft: 12,
  },
  headerSpacer: {
    flex: 1,
  },
  gainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  gainBtnText: {
    fontWeight: '500',
  },
  discArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
  },
  rings: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(180,150,255,0.12)',
  },
  disc: {
    padding: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: '#221B33',
  },
  discHole: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  trackInfo: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 6,
  },
  episodeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#5B8DEF',
    marginBottom: 8,
  },
  trackName: {
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  progressSection: {
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  seekBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  seekBtnLabel: {
    marginTop: -3,
    fontWeight: '700',
  },
  progressWrap: {
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 46,
    paddingTop: 2,
  },
  moreRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 8,
  },
  moreItem: {
    alignItems: 'center',
    gap: 5,
  },
  moreIconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 10,
  },
  bookBtn: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(160,92,255,0.5)',
  },
  sideBtn: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  mainPlayBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2979FF',
    shadowColor: '#2979FF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 8,
  },
})

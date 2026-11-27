import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { setCurrentTime, getDuration, getPosition } from '@/plugins/player'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange } from '@/utils/nativeModules/utils'
import { AppState } from 'react-native'
import { playNext } from '@/core/player/player'
import { initListenProgress, setListenProgress, flushListenProgress } from '@/core/listenProgress'

const delaySavePlayInfo = throttleBackgroundTimer(() => {
  void savePlayInfo({
    time: playerState.progress.nowPlayTime,
    maxTime: playerState.progress.maxPlayTime,
    listId: playerState.playMusicInfo.listId!,
    index: playerState.playInfo.playIndex,
  })
}, 2000)

export default () => {
  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  void initListenProgress()

  let updateTimeout: number | null = null
  let introSkippedId: string | null = ''
  let outroSkippedId: string | null = ''

  let isScreenOn = true

  const getCurrentTime = () => {
    let id = playerState.musicInfo.id
    void getPosition().then(position => {
      // 允许 position 为 0，否则刚播放时无法立即跳过片头，会延迟一轮轮询（约 1 秒）
      if (position == null || id != playerState.musicInfo.id) return

      // 图片样式版：跳过片头 / 片尾
      const skipIntro = settingState.setting['playDetail.skipIntro'] ?? 0
      const skipOutro = settingState.setting['playDetail.skipOutro'] ?? 0
      if (skipIntro > 0 && position < skipIntro) {
        // 片头：首次触发真实 seek，之后仅钳制显示进度，避免 seek 尚未生效时进度回跳到开头
        if (introSkippedId !== id) {
          introSkippedId = id
          void setCurrentTime(skipIntro)
        }
        setNowPlayTime(skipIntro)
        return
      }
      if (skipOutro > 0 && outroSkippedId !== id) {
        const maxTime = playerState.progress.maxPlayTime
        if (maxTime > skipOutro && position >= maxTime - skipOutro) {
          outroSkippedId = id
          void playNext()
          return
        }
      }

      setNowPlayTime(position)

      // 图片样式版：记录每首歌的已听进度（用于歌曲列表进度标识），仅正常播放时记录
      if (!playerState.playMusicInfo.isTempPlay) {
        const maxTime = playerState.progress.maxPlayTime
        if (id && maxTime > 0) setListenProgress(id, position, maxTime)
      }

      if (!playerState.isPlay) return

      if (settingState.setting['player.isSavePlayTime'] && !playerState.playMusicInfo.isTempPlay && isScreenOn) {
        delaySavePlayInfo()
      }
    })
  }
  const getMaxTime = async() => {
    setMaxplayTime(await getDuration())

    if (playerState.playMusicInfo.musicInfo && 'source' in playerState.playMusicInfo.musicInfo && !playerState.playMusicInfo.musicInfo.interval) {
      // console.log(formatPlayTime2(playProgress.maxPlayTime))

      if (playerState.playMusicInfo.listId) {
        void updateListMusics([{
          id: playerState.playMusicInfo.listId,
          musicInfo: {
            ...playerState.playMusicInfo.musicInfo,
            interval: formatPlayTime2(playerState.progress.maxPlayTime),
          },
        }])
      }
    }
  }

  const clearUpdateTimeout = () => {
    if (!updateTimeout) return
    BackgroundTimer.clearInterval(updateTimeout)
    updateTimeout = null
  }
  const startUpdateTimeout = () => {
    if (!isScreenOn) return
    clearUpdateTimeout()
    updateTimeout = BackgroundTimer.setInterval(() => {
      getCurrentTime()
    }, 1000 / settingState.setting['player.playbackRate'])
    getCurrentTime()
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    // console.log('setProgress', time, maxTime)
    setNowPlayTime(time)
    void setCurrentTime(time)

    if (maxTime != null) setMaxplayTime(maxTime)

    // if (!isPlay) audio.play()
  }


  const handlePlay = () => {
    void getMaxTime()
    // 图片样式版：播放开始/恢复时立即跳过片头，不等轮询，消除开头 1-2 秒延迟
    const skipIntro = settingState.setting['playDetail.skipIntro'] ?? 0
    const id = playerState.musicInfo.id
    if (skipIntro > 0 && introSkippedId !== id && playerState.progress.nowPlayTime < skipIntro) {
      introSkippedId = id
      setNowPlayTime(skipIntro)
      void setCurrentTime(skipIntro)
    }
    startUpdateTimeout()
  }
  const handlePause = () => {
    // prevProgressStatus = 'paused'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    // clearBufferTimeout()
    clearUpdateTimeout()
  }

  const handleStop = () => {
    clearUpdateTimeout()
    setNowPlayTime(0)
    setMaxplayTime(0)
    // prevProgressStatus = 'none'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
  }

  const handleError = () => {
    // if (!restorePlayTime) restorePlayTime = getCurrentTime() // 记录出错的播放时间
    // console.log('handleError')
    // prevProgressStatus = 'error'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    clearUpdateTimeout()
  }


  const handleSetPlayInfo = () => {
    introSkippedId = ''
    outroSkippedId = ''
    // restorePlayTime = playProgress.nowPlayTime
    // void setCurrentTime(playerState.progress.nowPlayTime)
    // setMaxplayTime(playProgress.maxPlayTime)
    handlePause()
    // 切歌前把上一首的进度落盘，避免节流窗口内丢失
    flushListenProgress()
    if (!playerState.playMusicInfo.isTempPlay) {
      // 图片样式版：启动恢复时 setPlayMusicInfo 会把进度重置为 0 并触发 musicToggled，
      // 若照此保存会覆盖磁盘上记住的播放进度。恢复期间改用恢复数据保存，避免进度丢失。
      const restoring = global.lx.restorePlayInfo
      void savePlayInfo({
        time: restoring ? restoring.time : playerState.progress.nowPlayTime,
        maxTime: restoring ? restoring.maxTime : playerState.progress.maxPlayTime,
        listId: playerState.playMusicInfo.listId!,
        index: playerState.playInfo.playIndex,
      })
    }
  }

  // watch(() => playerState.progress.nowPlayTime, (newValue, oldValue) => {
  //   if (settingState.setting['player.isSavePlayTime'] && !playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: newValue,
  //       maxTime: playerState.progress.maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })
  // watch(() => playerState.progress.maxPlayTime, maxPlayTime => {
  //   if (!playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: playerState.progress.nowPlayTime,
  //       maxTime: maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, settings) => {
    if (keys.includes('player.playbackRate')) startUpdateTimeout()
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      if (playerState.isPlay) startUpdateTimeout()
    } else clearUpdateTimeout()
  }

  // 修复在某些设备上屏幕状态改变事件未触发导致的进度条未更新的问题
  // 图片样式版：退到后台/锁屏前也保存一次进度，避免关闭应用时间较长后进度丢失
  AppState.addEventListener('change', (state) => {
    if (state == 'active' && !isScreenOn) handleScreenStateChanged('ON')
    if ((state == 'background' || state == 'inactive') &&
        settingState.setting['player.isSavePlayTime'] &&
        !playerState.playMusicInfo.isTempPlay &&
        playerState.musicInfo.id) {
      void savePlayInfo({
        time: playerState.progress.nowPlayTime,
        maxTime: playerState.progress.maxPlayTime,
        listId: playerState.playMusicInfo.listId!,
        index: playerState.playInfo.playIndex,
      })
      flushListenProgress()
    }
  })

  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  global.app_event.on('error', handleError)
  global.app_event.on('setProgress', setProgress)
  // global.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  // global.app_event.on('playerLoadeddata', handleLoadeddata)
  // global.app_event.on('playerCanplay', handleCanplay)
  // global.app_event.on('playerWaiting', handleWating)
  // global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)

  onScreenStateChange(handleScreenStateChanged)
}

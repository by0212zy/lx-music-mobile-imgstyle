import initPlayer from './player'
import initPlayInfo from './playInfo'
import initPlayStatus from './playStatus'
import initPlayerEvent from './playerEvent'
import initWatchList from './watchList'
import initPlayProgress from './playProgress'
import initPreloadNextMusic from './preloadNextMusic'
import initLyric from './lyric'
import { initListenProgress } from '@/core/listenProgress'

export default async(setting: LX.AppSetting) => {
  // 提前加载每首歌的已听进度：进度恢复依赖它，必须早于 initPlayInfo（内部会触发恢复播放）
  await initListenProgress()
  await initPlayer(setting)
  await initLyric(setting)
  await initPlayInfo(setting)
  initPlayStatus()
  initPlayerEvent()
  initWatchList()
  initPlayProgress()
  initPreloadNextMusic()
}

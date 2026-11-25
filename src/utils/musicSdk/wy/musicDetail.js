import { httpFetch } from '../../request'
import { weapi } from './utils/crypto'
import { formatPlayTime, sizeFormate } from '../../index'
// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/module/song_detail.js

export default {
  getSinger(singers) {
    let arr = []
    singers?.forEach(singer => {
      arr.push(singer.name)
    })
    return arr.join('、')
  },
  filterList({ songs, privileges }) {
    // console.log(songs, privileges)
    const list = []
    songs.forEach((item, index) => {
      const types = []
      const _types = {}
      let size
      let privilege = privileges[index]
      if (privilege.id !== item.id) privilege = privileges.find(p => p.id === item.id)
      if (!privilege) return

      if (privilege.maxBrLevel == 'hires') {
        size = item.hr ? sizeFormate(item.hr.size) : null
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = {
          size,
        }
      }
      switch (privilege.maxbr) {
        case 999000:
          size = item.sq ? sizeFormate(item.sq.size) : null
          types.push({ type: 'flac', size })
          _types.flac = {
            size,
          }
        case 320000:
          size = item.h ? sizeFormate(item.h.size) : null
          types.push({ type: '320k', size })
          _types['320k'] = {
            size,
          }
        case 192000:
        case 128000:
          size = item.l ? sizeFormate(item.l.size) : null
          types.push({ type: '128k', size })
          _types['128k'] = {
            size,
          }
      }

      types.reverse()

      if (item.pc) {
        list.push({
          singer: item.pc.ar ?? '',
          name: item.pc.sn ?? '',
          albumName: item.pc.alb ?? '',
          albumId: item.al?.id,
          source: 'wy',
          interval: formatPlayTime(item.dt / 1000),
          songmid: item.id,
          img: item.al?.picUrl ?? '',
          lrc: null,
          otherSource: null,
          types,
          _types,
          typeUrl: {},
        })
      } else {
        list.push({
          singer: this.getSinger(item.ar),
          name: item.name ?? '',
          albumName: item.al?.name,
          albumId: item.al?.id,
          source: 'wy',
          interval: formatPlayTime(item.dt / 1000),
          songmid: item.id,
          img: item.al?.picUrl,
          lrc: null,
          otherSource: null,
          types,
          _types,
          typeUrl: {},
        })
      }
    })
    // console.log(list)
    return list
  },
  async getList(ids = [], retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))

    // 图片样式版：分批请求，避免单次 id 过多导致接口失败，突破原 1000 首上限
    const BATCH_SIZE = 500
    const batches = []
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      batches.push(ids.slice(i, i + BATCH_SIZE))
    }
    if (!batches.length) return { source: 'wy', list: [] }

    const results = await Promise.all(batches.map(async batchIds => {
      const requestObj = httpFetch('https://music.163.com/weapi/v3/song/detail', {
        method: 'post',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
          origin: 'https://music.163.com',
        },
        form: weapi({
          c: '[' + batchIds.map(id => ('{"id":' + id + '}')).join(',') + ']',
          ids: '[' + batchIds.join(',') + ']',
        }),
      })
      const { body, statusCode } = await requestObj.promise
      if (statusCode != 200 || body.code !== 200) throw new Error('获取歌曲详情失败')
      return this.filterList(body)
    }))
    return { source: 'wy', list: results.flat() }
  },
}

import { useState } from 'react'
import { View, TouchableOpacity } from 'react-native'

import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import styles from './style'

const FONT_WEIGHTS = [
  { label: '常规', value: 400 },
  { label: '中等', value: 600 },
  { label: '加粗', value: 800 },
]

export const SettingLyricFontWeight = () => {
  const theme = useTheme()
  const fontWeight = useSettingValue('playDetail.lyricFontWeight') ?? 800

  return (
    <View style={styles.container}>
      <Text>歌词字体粗细</Text>
      <View style={styles.list}>
        {FONT_WEIGHTS.map(item => (
          <TouchableOpacity
            key={item.value}
            activeOpacity={0.6}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 8,
              marginRight: 8,
              marginTop: 4,
              backgroundColor: fontWeight === item.value ? theme['c-primary'] : 'rgba(128,128,128,0.18)',
            }}
            onPress={() => { updateSetting({ 'playDetail.lyricFontWeight': item.value }) }}
          >
            <Text size={13} color={fontWeight === item.value ? '#FFFFFF' : theme['c-font']}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

export const SettingLyricLineSpacing = () => {
  const theme = useTheme()
  const lineSpacing = useSettingValue('playDetail.lyricLineSpacing') ?? 10
  const [sliderValue, setSliderValue] = useState(lineSpacing)
  const [isSliding, setSliding] = useState(false)

  const handleSlidingStart: SliderProps['onSlidingStart'] = value => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = value => {
    setSliderValue(value)
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    if (lineSpacing === value) return
    updateSetting({ 'playDetail.lyricLineSpacing': value })
  }

  return (
    <View style={styles.container}>
      <Text>歌词行间距</Text>
      <View style={styles.content}>
        <Text style={styles.label} color={theme['c-font-label']}>{isSliding ? sliderValue : lineSpacing}</Text>
        <Slider
          minimumValue={0}
          maximumValue={40}
          step={2}
          value={lineSpacing}
          onSlidingStart={handleSlidingStart}
          onValueChange={handleValueChange}
          onSlidingComplete={handleSlidingComplete}
        />
      </View>
    </View>
  )
}

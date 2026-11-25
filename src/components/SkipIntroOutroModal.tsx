import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'

import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle } from '@/utils/tools'
import Slider, { type SliderProps } from '@/components/common/Slider'

export interface SkipIntroOutroModalType {
  show: () => void
}

const MAX_SKIP = 180

const SkipSliderRow = ({ label, settingKey }: {
  label: string
  settingKey: 'playDetail.skipIntro' | 'playDetail.skipOutro'
}) => {
  const theme = useTheme()
  const value = useSettingValue(settingKey) ?? 0
  const [sliderValue, setSliderValue] = useState(value)
  const [isSliding, setSliding] = useState(false)

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = v => {
    setSliderValue(v)
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = v => {
    setSliding(false)
    if (value === v) return
    updateSetting({ [settingKey]: v })
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text size={14} color={theme['c-font-label']}>{label}</Text>
        <Text size={14} color={theme['c-primary']}>{isSliding ? sliderValue : value} 秒</Text>
      </View>
      <Slider
        minimumValue={0}
        maximumValue={MAX_SKIP}
        step={1}
        value={value}
        onSlidingStart={handleSlidingStart}
        onValueChange={handleValueChange}
        onSlidingComplete={handleSlidingComplete}
      />
      <Text size={11} color={theme['c-font-label']}>0 秒为不跳过，可滑动到 {MAX_SKIP} 秒</Text>
    </View>
  )
}

export default forwardRef<SkipIntroOutroModalType>((_props, ref) => {
  const alertRef = useRef<ConfirmAlertType>(null)
  const [visible, setVisible] = useState(false)

  useImperativeHandle(ref, () => ({
    show() {
      if (visible) {
        alertRef.current?.setVisible(true)
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          alertRef.current?.setVisible(true)
        })
      }
    },
  }))

  if (!visible) return null

  return (
    <ConfirmAlert
      ref={alertRef}
      title="跳过片头片尾"
      cancelText="关闭"
      showConfirm={false}
      onCancel={() => {}}
    >
      <View style={styles.container}>
        <Text size={12} color="#8E86A8">播放时自动跳到片头之后，并在剩余时间到达片尾时长时切换下一首。</Text>
        <SkipSliderRow label="跳过片头" settingKey="playDetail.skipIntro" />
        <SkipSliderRow label="跳过片尾" settingKey="playDetail.skipOutro" />
      </View>
    </ConfirmAlert>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'column',
  },
  row: {
    marginTop: 16,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
})

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'

import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { createStyle } from '@/utils/tools'

const PRESETS = [0, 15, 30, 45, 60, 90, 120, 180]

export interface SkipIntroOutroModalType {
  show: () => void
}

const SkipRow = ({ label, value, settingKey }: {
  label: string
  value: number
  settingKey: 'playDetail.skipIntro' | 'playDetail.skipOutro'
}) => {
  const theme = useTheme()
  return (
    <View style={styles.row}>
      <Text size={14} color={theme['c-font-label']}>{label}（{value} 秒）</Text>
      <View style={styles.presets}>
        {PRESETS.map(second => (
          <TouchableOpacity
            key={second}
            activeOpacity={0.6}
            style={{
              ...styles.chip,
              backgroundColor: value === second ? theme['c-primary'] : 'rgba(128,128,128,0.18)',
            }}
            onPress={() => { updateSetting({ [settingKey]: second }) }}
          >
            <Text size={12} color={value === second ? '#FFFFFF' : theme['c-font']}>{second === 0 ? '不跳过' : `${second}s`}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

export default forwardRef<SkipIntroOutroModalType>((_props, ref) => {
  const alertRef = useRef<ConfirmAlertType>(null)
  const [visible, setVisible] = useState(false)
  const skipIntro = useSettingValue('playDetail.skipIntro') ?? 0
  const skipOutro = useSettingValue('playDetail.skipOutro') ?? 0

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
        <SkipRow label="跳过片头" value={skipIntro} settingKey="playDetail.skipIntro" />
        <SkipRow label="跳过片尾" value={skipOutro} settingKey="playDetail.skipOutro" />
      </View>
    </ConfirmAlert>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'column',
  },
  row: {
    marginTop: 14,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
  },
})

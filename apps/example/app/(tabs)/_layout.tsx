import {Tabs} from '@hzblj/kara-ui/router'

export default function TabLayout() {
  return (
    <Tabs>
      <Tabs.Screen icon="public" name="(world)" selectedIcon="public-filled" title="World" />
      <Tabs.Screen icon="translate" name="translate" selectedIcon="translate-filled" title="Translate" />
      <Tabs.Screen
        icon="download-for-offline"
        name="languages"
        selectedIcon="download-for-offline-filled"
        title="Languages"
      />
    </Tabs>
  )
}

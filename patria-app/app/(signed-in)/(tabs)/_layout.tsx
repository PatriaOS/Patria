import { Tabs } from 'expo-router';

import { useHomeNoticeCount } from '../../../src/features/family/useHomeNoticeCount';
import { copy } from '../../../src/lib/copy';
import { hiddenRootHeader } from '../../../src/lib/navigation';
import { useTheme } from '../../../src/theme';
import { TabBar, type TabKey } from '../../../src/ui';

function routeToTab(name: string): TabKey {
  if (name === 'memories' || name === 'vault' || name === 'family') {
    return name;
  }
  return 'home';
}

export default function SignedInTabsLayout() {
  const noticeCount = useHomeNoticeCount();
  const { colors } = useTheme();

  return (
    <Tabs
      tabBar={({ state, navigation }) => {
        const active = routeToTab(state.routes[state.index]?.name ?? 'home');
        return (
          <TabBar
            active={active}
            homeNoticeCount={noticeCount}
            onSelect={(tab) => {
              navigation.navigate(tab);
            }}
          />
        );
      }}
      screenOptions={{
        ...hiddenRootHeader,
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="home" options={{ title: copy.tabs.home }} />
      <Tabs.Screen name="memories" options={{ title: copy.tabs.memories }} />
      <Tabs.Screen name="vault" options={{ title: copy.tabs.vault }} />
      <Tabs.Screen name="family" options={{ title: copy.tabs.family }} />
    </Tabs>
  );
}

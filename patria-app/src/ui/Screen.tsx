import { type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space } from '../theme/tokens';
import { useTheme } from '../theme';
import { screenSafeEdges } from './screenEdges';

type ScrollViewRef = ComponentRef<typeof ScrollView>;

type Props = {
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  withHeader?: boolean;
  withTabBar?: boolean;
  keyboardAware?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  scrollRef?: Ref<ScrollViewRef>;
};

export function Screen({
  children,
  accessibilityLabel,
  testID,
  withHeader = false,
  withTabBar = false,
  keyboardAware = false,
  refreshing = false,
  onRefresh,
  scroll = true,
  scrollRef,
}: Props) {
  const { colors } = useTheme();
  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[
        styles.scroll,
        {
          backgroundColor: colors.background,
          // Tab screens sit under the status bar via SafeArea; keep side padding but
          // avoid a second empty band above the first content.
          paddingTop: withTabBar && !withHeader ? space.xs : space.screen,
          paddingBottom: withTabBar ? space.xxl + 80 : space.xxl,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      alwaysBounceVertical={Boolean(onRefresh)}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, styles.padded]}>{children}</View>
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={screenSafeEdges({ withHeader, withTabBar })}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {keyboardAware ? (
        <KeyboardAvoidingView
          testID="screen-keyboard"
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={withHeader ? 64 : 0}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  scroll: {
    padding: space.screen,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  padded: {
    padding: space.screen,
    gap: space.md,
  },
});

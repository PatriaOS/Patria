import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { SecurityStatusCard } from '../family/SecurityStatusCard';
import { copy } from '../../lib/copy';
import { isDesignPreviewRuntime } from '../../lib/localOrE2eRuntime';
import { space } from '../../theme/tokens';
import { Banner, Body, Button, Card, Muted, Screen, Title } from '../../ui';

type Shot = 'needs_attention' | 'finish_setup' | 'almost_done' | 'printed_after_repair';

/**
 * Local Supabase URL only (same gate as other design previews). Real D32
 * components + recovery copy for Simulator review. Query `?shot=` selects one
 * state. Never shows printed words. Phone tests use the real recovery flow.
 */
export function DesignRecoveryScreen() {
  const params = useLocalSearchParams<{ shot?: string }>();
  if (!isDesignPreviewRuntime()) {
    return <Redirect href="/" />;
  }
  const shot = (params.shot as Shot | undefined) ?? 'needs_attention';

  return (
    <Screen withHeader accessibilityLabel="Recovery design review" testID="design-recovery">
      {shot === 'needs_attention' ? (
        <View testID="design-recovery-needs-attention" style={styles.block}>
          <SecurityStatusCard
            keyStatus="ready"
            recoveryStatus="needs_attention"
            keyHolder
            admin
            familyName="Rivera"
            keysTestID="design-keys-status-attention"
            recoveryTestID="design-recovery-status-attention"
          />
          <Card testID="recovery-needs-attention-card">
            <Title>{copy.home.recoveryNeedsAttention}</Title>
            <Button
              label={copy.home.recoveryFinishSetup}
              testID="finish-recovery-setup"
              onPress={() => undefined}
            />
          </Card>
        </View>
      ) : null}

      {shot === 'finish_setup' ? (
        <View testID="design-recovery-finish-setup" style={styles.block}>
          <Card testID="recovery-needs-attention-card">
            <Title>{copy.home.recoveryNeedsAttention}</Title>
            <Button
              label={copy.home.recoveryFinishSetup}
              testID="finish-recovery-setup"
              onPress={() => undefined}
            />
          </Card>
          <Muted>{copy.home.recoveryFinishNeedsKeys}</Muted>
        </View>
      ) : null}

      {shot === 'almost_done' ? (
        <View testID="design-recovery-almost-done" style={styles.block}>
          <SecurityStatusCard
            keyStatus="ready"
            recoveryStatus="almost_done"
            keyHolder
            admin
            familyName="Rivera"
            keysTestID="design-keys-status-almost"
            recoveryTestID="design-recovery-status-almost"
          />
          <Card testID="recovery-almost-done-card">
            <Title>{copy.home.recoveryAlmostDone}</Title>
            <Body>{copy.home.needsYouPrintedBody}</Body>
            <Button
              label={copy.home.recoveryPrintedAction}
              testID="create-printed-code"
              onPress={() => undefined}
            />
          </Card>
        </View>
      ) : null}

      {shot === 'printed_after_repair' ? (
        <View testID="design-recovery-printed-after-repair" style={styles.block}>
          <Title>{copy.recovery.printedTitle}</Title>
          <Banner tone="warning" message={copy.recovery.printedAfterRepairBody} />
          <Muted>{copy.recovery.printedNeedAb}</Muted>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space.sm,
    marginBottom: space.lg,
  },
});

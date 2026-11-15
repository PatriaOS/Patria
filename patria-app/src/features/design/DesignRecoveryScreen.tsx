import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { SecurityStatusCard } from '../family/SecurityStatusCard';
import { RecoveryNeedsAttentionCard } from '../keys/RecoveryNeedsAttentionCard';
import { copy } from '../../lib/copy';
import { isDesignPreviewRuntime } from '../../lib/localOrE2eRuntime';
import { space } from '../../theme/tokens';
import { Banner, Body, Button, Card, Muted, Screen, Title } from '../../ui';

type Shot =
  | 'needs_attention'
  | 'finish_setup'
  | 'almost_done'
  | 'printed_need_ab'
  | 'printed_after_repair';

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
          <RecoveryNeedsAttentionCard onFinishSetup={() => undefined} />
        </View>
      ) : null}

      {shot === 'finish_setup' ? (
        <View testID="design-recovery-finish-setup" style={styles.block}>
          <RecoveryNeedsAttentionCard onFinishSetup={() => undefined} />
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

      {shot === 'printed_need_ab' ? (
        <View testID="design-recovery-printed-need-ab" style={styles.block}>
          <Body testID="printed-need-ab-message">{copy.recovery.printedNeedAb}</Body>
        </View>
      ) : null}

      {shot === 'printed_after_repair' ? (
        <View testID="design-recovery-printed-after-repair" style={styles.block}>
          <Title>{copy.recovery.printedTitle}</Title>
          <Banner tone="warning" message={copy.recovery.printedAfterRepairBody} />
          <Muted>{copy.recovery.printedContinue}</Muted>
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

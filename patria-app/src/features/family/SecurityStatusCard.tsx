import { StyleSheet, View } from 'react-native';

import type { FamilyKeyStatus } from '../../lib/crypto/familyCeremony';
import type { RecoveryHomeStatus } from '../../lib/crypto/recoverySetup';
import { Card, StatusPill } from '../../ui';
import { space } from '../../theme/tokens';
import { keyStatusLabel, recoveryPill } from './securityStatus';

type Props = {
  keyStatus: FamilyKeyStatus | undefined;
  recoveryStatus: RecoveryHomeStatus | undefined;
  keyHolder: boolean;
  admin: boolean;
  familyName: string;
  /** Home shows only what needs attention; Family shows every status. */
  attentionOnly?: boolean;
  keysTestID: string;
  recoveryTestID: string;
  rowTestID?: string;
};

/** Keys and recovery status pills (same wording and tones Home used before D35). */
export function SecurityStatusCard({
  keyStatus,
  recoveryStatus,
  keyHolder,
  admin,
  familyName,
  attentionOnly = false,
  keysTestID,
  recoveryTestID,
  rowTestID,
}: Props) {
  const showKeys = Boolean(keyStatus) && (!attentionOnly || keyStatus !== 'ready');
  const pill = recoveryPill({ keyHolder, admin, familyName, status: recoveryStatus });
  const showRecovery =
    pill !== null && (!attentionOnly || recoveryStatus === 'needs_attention');
  if (!showKeys && !showRecovery) {
    return null;
  }
  return (
    <Card tone="warm">
      <View testID={rowTestID} style={styles.statusRow}>
        {showKeys && keyStatus ? (
          <StatusPill
            testID={keysTestID}
            label={keyStatusLabel(keyStatus)}
            tone={keyStatus === 'ready' ? 'success' : 'wait'}
          />
        ) : null}
        {showRecovery && pill ? (
          <StatusPill testID={recoveryTestID} label={pill.label} tone={pill.tone} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
});

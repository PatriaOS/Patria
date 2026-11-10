import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import type { FamilyKeyStatus } from '../../lib/crypto/familyCeremony';
import type { PersonalKeyDeviceStatus } from '../../lib/crypto/personalKey';
import type { RecoveryHomeStatus } from '../../lib/crypto/recoverySetup';
import { Body, Button, Card, ErrorState, StatusPill } from '../../ui';
import { space } from '../../theme/tokens';
import {
  keyStatusLabel,
  personalKeyStatusLabel,
  personalKeyStatusTone,
  recoveryPill,
} from './securityStatus';

type Props = {
  keyStatus: FamilyKeyStatus | undefined;
  personalStatus?: PersonalKeyDeviceStatus | undefined;
  recoveryStatus: RecoveryHomeStatus | undefined;
  keyHolder: boolean;
  admin: boolean;
  familyName: string;
  /** Home shows only what needs attention; Family shows every status. */
  attentionOnly?: boolean;
  keysTestID: string;
  personalKeysTestID?: string;
  recoveryTestID: string;
  rowTestID?: string;
  onRetryPersonalEnroll?: () => void;
  onSetUpRecoveryForPersonal?: () => void;
};

/** Keys and recovery status pills (same wording and tones Home used before D35). */
export function SecurityStatusCard({
  keyStatus,
  personalStatus,
  recoveryStatus,
  keyHolder,
  admin,
  familyName,
  attentionOnly = false,
  keysTestID,
  personalKeysTestID = 'personal-keys-status',
  recoveryTestID,
  rowTestID,
  onRetryPersonalEnroll,
  onSetUpRecoveryForPersonal,
}: Props) {
  const showKeys = Boolean(keyStatus) && (!attentionOnly || keyStatus !== 'ready');
  const showPersonal =
    Boolean(personalStatus) &&
    (!attentionOnly ||
      personalStatus === 'needsOtherPhone' ||
      personalStatus === 'needsRecovery' ||
      personalStatus === 'enrollError');
  const pill = recoveryPill({ keyHolder, admin, familyName, status: recoveryStatus });
  const showRecovery =
    pill !== null && (!attentionOnly || recoveryStatus === 'needs_attention');
  if (!showKeys && !showPersonal && !showRecovery) {
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
        {showPersonal && personalStatus ? (
          <StatusPill
            testID={personalKeysTestID}
            label={personalKeyStatusLabel(personalStatus)}
            tone={personalKeyStatusTone(personalStatus)}
          />
        ) : null}
        {showRecovery && pill ? (
          <StatusPill testID={recoveryTestID} label={pill.label} tone={pill.tone} />
        ) : null}
      </View>
      {personalStatus === 'needsRecovery' ? (
        <View style={styles.nextStep} testID="personal-keys-needs-recovery">
          <Body>{copy.home.personalKeysNeedRecovery}</Body>
          {onSetUpRecoveryForPersonal ? (
            <Button
              label={copy.home.personalKeysNeedRecoveryAction}
              testID="personal-keys-set-up-recovery"
              onPress={onSetUpRecoveryForPersonal}
            />
          ) : null}
        </View>
      ) : null}
      {personalStatus === 'enrollError' ? (
        <View style={styles.enrollError} testID="personal-keys-enroll-error">
          <ErrorState message={copy.home.personalKeysEnrollFailed} />
          {onRetryPersonalEnroll ? (
            <Button
              label={copy.home.personalKeysEnrollRetry}
              variant="secondary"
              testID="personal-keys-enroll-retry"
              onPress={onRetryPersonalEnroll}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  nextStep: {
    marginTop: space.sm,
    gap: space.sm,
  },
  enrollError: {
    marginTop: space.sm,
    gap: space.sm,
  },
});

import { Body, Button, Card, Title } from '../../ui';
import { copy } from '../../lib/copy';

type Props = {
  busy?: boolean;
  onFinishSetup: () => void;
};

/** Shared needs-attention card (Family, Privacy and Security, Recovery setup). */
export function RecoveryNeedsAttentionCard({ busy = false, onFinishSetup }: Props) {
  return (
    <Card testID="recovery-needs-attention-card">
      <Title>{copy.home.recoveryNeedsAttention}</Title>
      <Body>{copy.home.recoveryFinishSetupBody}</Body>
      <Button
        label={copy.home.recoveryFinishSetup}
        testID="finish-recovery-setup"
        busy={busy}
        onPress={onFinishSetup}
      />
    </Card>
  );
}

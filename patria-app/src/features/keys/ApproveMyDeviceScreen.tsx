import { Button, Card, Muted, Title } from '../../ui';
import { copy } from '../../lib/copy';
import type { FirstDeviceNotice } from '../../lib/crypto/deviceAccess';

export function formatDeviceWhen(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? iso : when.toLocaleString();
}

type ApproveMyDeviceCardProps = {
  notice: FirstDeviceNotice;
  name: string;
  canApprove: boolean;
  busy: boolean;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
};

export function ApproveMyDeviceCard({
  notice,
  name,
  canApprove,
  busy,
  disabled,
  onApprove,
  onReject,
}: ApproveMyDeviceCardProps) {
  const whenLabel = formatDeviceWhen(notice.deviceCreatedAt);
  const setUp = copy.home.deviceSetUp.replace('{when}', whenLabel);

  if (!canApprove) {
    return (
      <Card>
        <Title>{copy.home.extraDeviceAdminNotice.replace('{name}', name)}</Title>
        <Muted>{setUp}</Muted>
      </Card>
    );
  }

  return (
    <Card>
      <Title>{copy.home.extraDeviceOwnNotice}</Title>
      <Muted>{setUp}</Muted>
      <Button
        label={copy.home.yesMyPhone}
        busy={busy}
        disabled={disabled}
        onPress={onApprove}
        accessibilityHint={copy.home.extraDeviceOwnNotice}
      />
      <Button
        label={copy.home.notMyPhone}
        variant="secondary"
        busy={busy}
        disabled={disabled}
        onPress={onReject}
      />
    </Card>
  );
}

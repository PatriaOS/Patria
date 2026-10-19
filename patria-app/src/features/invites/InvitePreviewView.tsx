import { Body, Button, Muted, Title } from '../../ui';
import { copy } from '../../lib/copy';
import type { InvitePreview } from '../../lib/family';

type InvitePreviewViewProps = {
  preview: InvitePreview;
  signedIn: boolean;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
};

export function InvitePreviewView({
  preview,
  signedIn,
  busy,
  error,
  onAccept,
  onDecline,
  onSignIn,
  onSignUp,
}: InvitePreviewViewProps) {
  const invitedLine = copy.invitePreview.invitedBy
    .replace('{name}', preview.inviter_display_name || copy.appName)
    .replace('{family}', preview.family_space_name);
  const roleLine = copy.invitePreview.role.replace(
    '{role}',
    copy.roles[preview.role],
  );
  const circleLine = copy.invitePreview.circle.replace(
    '{circle}',
    preview.default_circle_name,
  );

  return (
    <>
      <Title>{copy.invitePreview.title}</Title>
      <Body>{invitedLine}</Body>
      <Body>{roleLine}</Body>
      <Muted>{circleLine}</Muted>
      <Body>{copy.invitePreview.summaryTitle}</Body>
      <Body>{preview.visibility_summary}</Body>
      {error ? <Muted>{error}</Muted> : null}
      {signedIn ? (
        <>
          <Button
            label={copy.invitePreview.accept}
            onPress={onAccept}
            disabled={busy}
          />
          <Button
            label={copy.invitePreview.decline}
            variant="secondary"
            onPress={onDecline}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <Body>{copy.invitePreview.signInFirst}</Body>
          <Button label={copy.invitePreview.goSignIn} onPress={onSignIn} />
          <Button
            label={copy.invitePreview.goSignUp}
            variant="secondary"
            onPress={onSignUp}
          />
        </>
      )}
    </>
  );
}

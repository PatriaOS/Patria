import { Body, Button, Card, Caption, Muted, Overline, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { formatVoiceLength } from '../vault/vaultOpen';
import { VoicePlayer } from '../vault/VoicePlayer';
import type { HomeVoicePeek } from './homeVaultPeek';

type Props = {
  peek: HomeVoicePeek;
  loading: boolean;
  failed: boolean;
  canRecord: boolean;
  spaceId: string | undefined;
  onRecord: () => void;
  onOpenVault: () => void;
  onRetry: () => void;
};

/** Latest voice note — tone warm (sand box, mustard CTA). */
export function HomeVoiceCard(props: Props) {
  if (props.loading) {
    return (
      <Card tone="warm" testID="home-voice-loading">
        <Muted>{copy.common.loading}</Muted>
      </Card>
    );
  }

  if (props.failed) {
    return (
      <Card tone="warm" testID="home-voice-error">
        <Muted>{copy.home.voiceCardFailed}</Muted>
        <Button label={copy.home.cardRetry} variant="secondary" onPress={props.onRetry} />
      </Card>
    );
  }

  if (props.peek.state === 'locked') {
    return (
      <Card tone="warm" testID="home-voice-locked">
        <Overline>{copy.home.voiceCardOverline}</Overline>
        <Title>{copy.home.voiceCardOverline}</Title>
        <Body>{copy.home.voiceCardLocked}</Body>
      </Card>
    );
  }

  if (props.peek.state === 'empty') {
    return (
      <Card tone="warm" testID="home-voice-empty">
        <Overline>{copy.home.voiceCardOverline}</Overline>
        <Title>{copy.home.voiceCardEmptyTitle}</Title>
        <Body>{copy.home.voiceCardEmptyBody}</Body>
        {props.canRecord ? (
          <Button
            label={copy.home.voiceCardRecord}
            testID="home-voice-record"
            onPress={props.onRecord}
          />
        ) : (
          <Muted>{copy.home.voiceCardAskAdmin}</Muted>
        )}
      </Card>
    );
  }

  if (props.peek.state === 'older') {
    return (
      <Card tone="warm" testID="home-voice-older">
        <Overline>{copy.home.voiceCardOverline}</Overline>
        <Title>{copy.home.voiceCardOlder}</Title>
        <Button
          label={copy.home.voiceCardOpenVault}
          testID="home-voice-open-vault"
          onPress={props.onOpenVault}
        />
      </Card>
    );
  }

  const note = props.peek;
  const meta = copy.home.voiceCardBy
    .replace('{name}', note.authorLabel)
    .replace('{when}', note.whenLabel)
    .replace('{length}', formatVoiceLength(note.durationSeconds));

  return (
    <Card tone="warm" testID="home-voice-card">
      <Overline>{copy.home.voiceCardOverline}</Overline>
      <Title testID="home-voice-title">{note.title}</Title>
      <Caption tone="muted">{meta}</Caption>
      {props.spaceId ? (
        <VoicePlayer spaceId={props.spaceId} entryId={note.entryId} audio={note.audio} />
      ) : null}
    </Card>
  );
}

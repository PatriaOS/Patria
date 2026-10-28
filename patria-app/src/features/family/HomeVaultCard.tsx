import { Body, Button, Card, Caption, Muted, Overline, Title } from '../../ui';
import { copy } from '../../lib/copy';
import type { HomeVaultHighlight } from './homeVaultPeek';

type Props = {
  peek: HomeVaultHighlight;
  loading: boolean;
  failed: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onOpenVault: () => void;
  onRetry: () => void;
};

/** From the Vault — tone hero (green box, mustard CTA). */
export function HomeVaultCard(props: Props) {
  if (props.loading) {
    return (
      <Card tone="hero" testID="home-vault-loading">
        <Muted>{copy.common.loading}</Muted>
      </Card>
    );
  }

  if (props.failed) {
    return (
      <Card tone="hero" testID="home-vault-error">
        <Muted>{copy.home.vaultCardFailed}</Muted>
        <Button label={copy.home.cardRetry} variant="secondary" onPress={props.onRetry} />
      </Card>
    );
  }

  if (props.peek.state === 'locked') {
    return (
      <Card tone="hero" testID="home-vault-locked">
        <Overline>{copy.home.vaultCardOverline}</Overline>
        <Title>{copy.vault.title}</Title>
        <Body>{copy.home.vaultCardLocked}</Body>
      </Card>
    );
  }

  if (props.peek.state === 'empty') {
    return (
      <Card tone="hero" testID="home-vault-empty">
        <Overline>{copy.home.vaultCardOverline}</Overline>
        <Title>{copy.home.vaultCardEmptyTitle}</Title>
        <Body>{copy.home.vaultCardEmptyBody}</Body>
        {props.canAdd ? (
          <Button label={copy.home.vaultCardAdd} testID="home-vault-add" onPress={props.onAdd} />
        ) : (
          <Muted>{copy.home.vaultCardAskAdmin}</Muted>
        )}
      </Card>
    );
  }

  const visibility =
    props.peek.visibility === 'private'
      ? copy.home.vaultCardVisibilityOnlyMe
      : copy.home.vaultCardVisibilityFamily;

  return (
    <Card tone="hero" testID="home-vault-card">
      <Overline>{copy.home.vaultCardOverline}</Overline>
      <Title testID="home-vault-title">{props.peek.title}</Title>
      <Caption tone="muted">
        {props.peek.whenLabel} · {visibility}
      </Caption>
      <Button
        label={copy.home.vaultCardOpen}
        testID="home-vault-open"
        onPress={props.onOpenVault}
      />
    </Card>
  );
}

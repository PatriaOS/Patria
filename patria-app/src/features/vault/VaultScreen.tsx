import { copy } from '../../lib/copy';
import { EmptyState, Screen } from '../../ui';

export function VaultScreen() {
  return (
    <Screen withTabBar testID="screen-vault" accessibilityLabel={copy.vault.title}>
      <EmptyState title={copy.vault.emptyTitle} message={copy.vault.emptyBody} />
    </Screen>
  );
}

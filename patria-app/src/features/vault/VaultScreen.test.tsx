import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { VaultScreen } from './VaultScreen';

describe('Vault tab', () => {
  it('shows a calm empty state and no actions', () => {
    const { getByTestId, getByText, queryByText } = renderScreen(<VaultScreen />);
    expect(getByTestId('screen-vault')).toBeTruthy();
    expect(getByText(copy.vault.emptyTitle)).toBeTruthy();
    expect(getByText(copy.vault.emptyBody)).toBeTruthy();
    expect(queryByText(copy.common.save)).toBeNull();
  });
});

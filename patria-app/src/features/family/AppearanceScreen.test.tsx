import { fireEvent } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { AppearanceScreen } from './AppearanceScreen';

describe('Appearance', () => {
  it('lets someone pick Match my phone, Light or Dark', async () => {
    const { getByLabelText, getByTestId } = await renderScreen(<AppearanceScreen />);
    expect(getByTestId('screen-appearance')).toBeTruthy();
    expect(getByLabelText(copy.appearance.light).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(getByLabelText(copy.appearance.dark));
    expect(getByLabelText(copy.appearance.dark).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });
});

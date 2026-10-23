import { fireEvent } from '@testing-library/react-native';

import { renderScreen } from '../test/renderScreen';
import { Button } from './Button';

describe('Button', () => {
  it('becomes pressable when disabled flips to enabled, with no other change', async () => {
    const onPress = jest.fn();
    const view = await renderScreen(<Button label="Save" onPress={onPress} disabled />);
    await fireEvent.press(view.getByTestId('save'));
    expect(onPress).not.toHaveBeenCalled();

    view.rerender(<Button label="Save" onPress={onPress} disabled={false} />);
    await fireEvent.press(await view.findByTestId('save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

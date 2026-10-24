import { fireEvent } from '@testing-library/react-native';

import { renderScreen } from '../test/renderScreen';
import { Pressable } from './Pressable';
import { Body } from './Text';

describe('Pressable', () => {
  it('ignores presses while inactive, then fires once when enabled', async () => {
    const onPress = jest.fn();
    const view = await renderScreen(
      <Pressable testID="row" disabled onPress={onPress}>
        <Body>Row</Body>
      </Pressable>,
    );
    await fireEvent.press(view.getByTestId('row'));
    expect(onPress).not.toHaveBeenCalled();

    view.rerender(
      <Pressable testID="row" disabled={false} onPress={onPress}>
        <Body>Row</Body>
      </Pressable>,
    );
    await fireEvent.press(await view.findByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('collapses a double fire into one press', async () => {
    const onPress = jest.fn();
    const view = await renderScreen(
      <Pressable testID="row" onPress={onPress}>
        <Body>Row</Body>
      </Pressable>,
    );
    const row = view.getByTestId('row');
    await fireEvent.press(row);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

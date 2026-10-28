import { Text, View } from 'react-native';

import { space } from '../theme/tokens';
import { renderScreen } from '../test/renderScreen';
import { ButtonStack } from './ButtonStack';

describe('ButtonStack', () => {
  it('stacks children with the D32 sm gap', async () => {
    const { getByTestId } = await renderScreen(
      <ButtonStack testID="stack">
        <View>
          <Text>One</Text>
        </View>
        <View>
          <Text>Two</Text>
        </View>
      </ButtonStack>,
    );
    expect(getByTestId('stack')).toHaveStyle({ gap: space.sm, width: '100%' });
  });
});

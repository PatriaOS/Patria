import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { WelcomeScreen } from './WelcomeScreen';

describe('WelcomeScreen', () => {
  it('marks the welcome screen container for navigation', async () => {
    const { getByTestId, getByText } = await renderScreen(<WelcomeScreen />);
    expect(getByTestId('screen-welcome')).toBeTruthy();
    expect(getByText(copy.welcome.signIn)).toBeTruthy();
  });
});

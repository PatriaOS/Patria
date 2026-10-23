import { copy } from '../lib/copy';
import { renderScreen } from '../test/renderScreen';
import { PlaceholderScreen } from './PlaceholderScreen';

describe('PlaceholderScreen', () => {
  it('renders title and body copy', async () => {
    const { getByText } = await renderScreen(
      <PlaceholderScreen
        title={copy.welcome.title}
        body={copy.welcome.body}
        accessibilityLabel={copy.welcome.title}
      />,
    );

    expect(getByText(copy.welcome.title)).toBeTruthy();
    expect(getByText(copy.welcome.body)).toBeTruthy();
    expect(getByText(copy.welcome.title).props.maxFontSizeMultiplier).toBe(1.3);
    expect(getByText(copy.welcome.title).props.allowFontScaling).not.toBe(false);
  });
});

import { dark, light } from '../theme/tokens';
import { ThemeProvider } from '../theme';
import { render } from '@testing-library/react-native';
import { Card } from './Card';

describe('Card', () => {
  it('never uses light cream in dark mode', () => {
    const { getByTestId } = render(
      <ThemeProvider initialAppearance="dark" persist={false} fontsReady>
        <Card testID="card">Hello</Card>
      </ThemeProvider>,
    );
    const style = getByTestId('card').props.style;
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: dark.surface })]));
    expect(JSON.stringify(style)).not.toContain(light.surface);
    expect(JSON.stringify(style)).not.toContain(light.background);
  });
});

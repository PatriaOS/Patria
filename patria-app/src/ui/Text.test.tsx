import { typeScale } from '../theme/tokens';
import { renderScreen } from '../test/renderScreen';
import { Body, Title } from './Text';

describe('Heirloom text', () => {
  it('applies the type scale line height and caps scaling at 1.3', async () => {
    const { getByText } = await renderScreen(
      <>
        <Title>Heading</Title>
        <Body>Body copy</Body>
      </>,
    );
    expect(getByText('Heading').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lineHeight: typeScale.title.size * typeScale.title.line,
        }),
      ]),
    );
    expect(getByText('Body copy').props.maxFontSizeMultiplier).toBe(1.3);
    expect(typeScale.body).toHaveProperty('line');
    expect(typeScale.body).not.toHaveProperty('lineHeight');
  });

  it('uses lining numerals on Cormorant roles', async () => {
    const { getByText } = await renderScreen(<Title>Test 1</Title>);
    expect(getByText('Test 1').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontVariant: ['lining-nums'] })]),
    );
  });
});

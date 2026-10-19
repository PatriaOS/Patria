import { typeScale } from '../theme/tokens';
import { renderScreen } from '../test/renderScreen';
import { Body, Title } from './Text';

describe('Heirloom text', () => {
  it('does not pin line height and caps scaling at 1.3', () => {
    const { getByText } = renderScreen(
      <>
        <Title>Heading</Title>
        <Body>Body copy</Body>
      </>,
    );
    expect(getByText('Heading').props.style).toEqual(
      expect.arrayContaining([expect.not.objectContaining({ lineHeight: expect.anything() })]),
    );
    expect(getByText('Body copy').props.maxFontSizeMultiplier).toBe(1.3);
    expect(typeScale.body).toHaveProperty('line');
    expect(typeScale.body).not.toHaveProperty('lineHeight');
  });

  it('uses lining numerals on Cormorant roles', () => {
    const { getByText } = renderScreen(<Title>Test 1</Title>);
    expect(getByText('Test 1').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontVariant: ['lining-nums'] })]),
    );
  });
});

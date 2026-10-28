import { Bell, Menu, X } from 'lucide-react-native';

import { renderScreen } from '../test/renderScreen';
import { Icon } from './Icon';

describe('Icon', () => {
  it('draws menu, bell and x from the local SVG map (same path as the tab bar)', async () => {
    const view = await renderScreen(
      <>
        <Icon icon={Menu} name="menu" />
        <Icon icon={Bell} name="bell" />
        <Icon icon={X} name="x" />
      </>,
    );
    // Missing map keys render an empty Svg with no Path children; mapped icons have strokes.
    expect(view.toJSON()).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).toMatch(/Path|path/);
  });
});

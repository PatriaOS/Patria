import { Settings } from 'lucide-react-native';
import Svg from 'react-native-svg';

import { renderScreen } from '../test/renderScreen';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';

describe('accessibility of decorative art and icon buttons', () => {
  it('hides EmptyState art from accessibility', () => {
    const { UNSAFE_getByType } = renderScreen(
      <EmptyState title="Nothing here yet" message="Add something when you are ready." />,
    );
    const art = UNSAFE_getByType(Svg);
    expect(art.props.accessibilityElementsHidden).toBe(true);
    expect(art.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('keeps a label on an icon-only button', () => {
    const { getByLabelText } = renderScreen(
      <IconButton icon={Settings} accessibilityLabel="Settings" onPress={() => undefined} />,
    );
    expect(getByLabelText('Settings').props.accessibilityRole).toBe('button');
  });
});

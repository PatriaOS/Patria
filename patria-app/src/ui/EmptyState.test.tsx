import { Settings } from 'lucide-react-native';

import { renderScreen } from '../test/renderScreen';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';

describe('accessibility of decorative art and icon buttons', () => {
  it('hides EmptyState art from accessibility', async () => {
    const { getByTestId } = await renderScreen(
      <EmptyState title="Nothing here yet" message="Add something when you are ready." />,
    );
    const art = getByTestId('empty-state-art', { includeHiddenElements: true });
    expect(art.props.accessibilityElementsHidden).toBe(true);
    expect(art.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('keeps a label on an icon-only button', async () => {
    const { getByLabelText } = await renderScreen(
      <IconButton icon={Settings} accessibilityLabel="Settings" onPress={() => undefined} />,
    );
    expect(getByLabelText('Settings').props.accessibilityRole).toBe('button');
  });
});

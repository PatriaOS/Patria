import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { DesignGalleryScreen } from './DesignGalleryScreen';

describe('Design gallery', () => {
  it('shows the Layer 1 kit in development', async () => {
    const { getByTestId, getByText, getByLabelText } = await renderScreen(<DesignGalleryScreen />);
    expect(getByTestId('design-gallery')).toBeTruthy();
    expect(getByText(copy.design.galleryTitle)).toBeTruthy();
    expect(getByLabelText(copy.design.iconOnly)).toBeTruthy();
    expect(getByLabelText('Home, 1 notice')).toBeTruthy();
  });
});

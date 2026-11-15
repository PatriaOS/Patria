import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { DesignGalleryScreen } from './DesignGalleryScreen';

describe('Design gallery', () => {
  const previousE2e = process.env.EXPO_PUBLIC_E2E;

  const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_E2E = '1';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  });

  afterEach(() => {
    if (previousE2e === undefined) {
      delete process.env.EXPO_PUBLIC_E2E;
    } else {
      process.env.EXPO_PUBLIC_E2E = previousE2e;
    }
    if (previousUrl === undefined) {
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    } else {
      process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
    }
  });

  it('shows the Layer 1 kit on a local/e2e stack', async () => {
    const { getByTestId, getByText, getByLabelText } = await renderScreen(<DesignGalleryScreen />);
    expect(getByTestId('design-gallery')).toBeTruthy();
    expect(getByText(copy.design.galleryTitle)).toBeTruthy();
    expect(getByLabelText(copy.design.iconOnly)).toBeTruthy();
    expect(getByLabelText('Home, 1 notice')).toBeTruthy();
  });
});

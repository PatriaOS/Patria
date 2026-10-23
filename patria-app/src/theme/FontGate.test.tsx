import { copy } from '../lib/copy';
import { renderScreen } from '../test/renderScreen';
import { FontGateSplash } from './FontGate';

describe('FontGate splash', () => {
  it('is a short branded wait, not a hang', async () => {
    const { getByTestId, getByText } = await renderScreen(<FontGateSplash />);
    expect(getByTestId('font-gate-splash')).toBeTruthy();
    expect(getByText(copy.appName)).toBeTruthy();
  });
});

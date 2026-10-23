import { fireEvent } from '@testing-library/react-native';

import { countHomeNotices } from '../features/family/homeNotices';
import { copy } from '../lib/copy';
import { renderScreen } from '../test/renderScreen';
import { TabBar, homeTabAccessibilityLabel } from './TabBar';

const letInNotice = {
  id: 'n1',
  spaceId: 's1',
  userId: 'u2',
  deviceId: 'd1',
  publicKey: new Uint8Array(32),
  deviceCreatedAt: '2026-10-18T00:00:00.000Z',
  kind: 'first_device' as const,
};

describe('TabBar', () => {
  it('exposes tabs with selected state', async () => {
    const onSelect = jest.fn();
    const { getByLabelText } = await renderScreen(<TabBar active="memories" onSelect={onSelect} />);
    expect(getByLabelText(copy.tabs.memories).props.accessibilityRole).toBe('tab');
    expect(getByLabelText(copy.tabs.memories).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(getByLabelText(copy.tabs.home).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    await fireEvent.press(getByLabelText(copy.tabs.vault));
    expect(onSelect).toHaveBeenCalledWith('vault');
  });

  it('shows a Home notice when another tab is active', async () => {
    const { getByLabelText, getByTestId, queryByTestId } = await renderScreen(
      <TabBar active="family" onSelect={() => undefined} homeNoticeCount={1} />,
    );
    expect(getByLabelText('Home, 1 notice')).toBeTruthy();
    expect(getByTestId('home-tab-notice')).toBeTruthy();
    expect(homeTabAccessibilityLabel(2, false)).toBe('Home, 2 notices');

    const onHome = await renderScreen(<TabBar active="home" onSelect={() => undefined} homeNoticeCount={1} />);
    expect(onHome.getByLabelText(copy.tabs.home)).toBeTruthy();
    expect(onHome.queryByTestId('home-tab-notice')).toBeNull();
    expect(queryByTestId('home-tab-notice')).toBeTruthy();
  });

  it('shows Home, 1 notice from a let-in request when Family is selected', async () => {
    const homeNoticeCount = countHomeNotices({
      deviceNotices: [letInNotice],
      recoveryPendingInvites: 0,
      recoveryRequests: [],
      removedNoticeCount: 0,
      userId: 'u1',
    });
    expect(homeNoticeCount).toBe(1);
    const { getByLabelText, getByTestId, queryByTestId } = await renderScreen(
      <TabBar active="family" onSelect={() => undefined} homeNoticeCount={homeNoticeCount} />,
    );
    expect(getByLabelText('Home, 1 notice')).toBeTruthy();
    expect(getByTestId('home-tab-notice')).toBeTruthy();
    expect(queryByTestId('home-tab-notice')?.props.accessible).toBe(false);
  });

  it('hides the Home notice when nothing is waiting', async () => {
    const homeNoticeCount = countHomeNotices({
      deviceNotices: [],
      recoveryPendingInvites: 0,
      recoveryRequests: [],
      removedNoticeCount: 0,
      userId: 'u1',
    });
    expect(homeNoticeCount).toBe(0);
    const { getByLabelText, queryByTestId } = await renderScreen(
      <TabBar active="family" onSelect={() => undefined} homeNoticeCount={homeNoticeCount} />,
    );
    expect(getByLabelText(copy.tabs.home)).toBeTruthy();
    expect(queryByTestId('home-tab-notice')).toBeNull();
  });
});

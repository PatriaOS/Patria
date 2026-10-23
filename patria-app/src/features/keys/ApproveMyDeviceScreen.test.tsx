import { fireEvent } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { ApproveMyDeviceCard } from './ApproveMyDeviceScreen';

const notice = {
  id: 'n1',
  spaceId: 's1',
  userId: 'u1',
  deviceId: 'd-new',
  publicKey: new Uint8Array(32),
  deviceCreatedAt: '2026-10-12T12:00:00.000Z',
  kind: 'extra_device' as const,
};

describe('ApproveMyDeviceCard', () => {
  it('shows Yes and This wasn’t me for the owner', async () => {
    const onApprove = jest.fn();
    const onReject = jest.fn();
    const { getByText } = await renderScreen(
      <ApproveMyDeviceCard
        notice={notice}
        name="Elena"
        canApprove
        busy={false}
        disabled={false}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    expect(getByText(copy.home.extraDeviceOwnNotice)).toBeTruthy();
    await fireEvent.press(getByText(copy.home.yesMyPhone));
    expect(onApprove).toHaveBeenCalled();
    await fireEvent.press(getByText(copy.home.notMyPhone));
    expect(onReject).toHaveBeenCalled();
  });

  it('hides approve buttons for admins', async () => {
    const { getByText, queryByText } = await renderScreen(
      <ApproveMyDeviceCard
        notice={{ ...notice, userId: 'u2' }}
        name="Marco"
        canApprove={false}
        busy={false}
        disabled
        onApprove={() => undefined}
        onReject={() => undefined}
      />,
    );
    expect(getByText('Marco added a new phone')).toBeTruthy();
    expect(queryByText(copy.home.yesMyPhone)).toBeNull();
    expect(queryByText(copy.home.letIn)).toBeNull();
  });
});

import { fireEvent } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { SecurityStatusCard } from './SecurityStatusCard';

describe('SecurityStatusCard personal key', () => {
  it('shows personal ready on Family and enroll error with retry', async () => {
    const onRetry = jest.fn();
    const ready = await renderScreen(
      <SecurityStatusCard
        keyStatus="ready"
        personalStatus="ready"
        recoveryStatus={undefined}
        keyHolder
        admin
        familyName="The Riveras"
        keysTestID="family-keys-status"
        personalKeysTestID="family-personal-keys-status"
        recoveryTestID="family-recovery-status"
      />,
    );
    expect(await ready.findByText(copy.home.keysReady)).toBeTruthy();
    expect(await ready.findByText(copy.home.personalKeysReady)).toBeTruthy();

    const failed = await renderScreen(
      <SecurityStatusCard
        attentionOnly
        keyStatus="ready"
        personalStatus="enrollError"
        recoveryStatus={undefined}
        keyHolder
        admin
        familyName="The Riveras"
        keysTestID="home-keys-status"
        personalKeysTestID="home-personal-keys-status"
        recoveryTestID="home-recovery-status"
        onRetryPersonalEnroll={onRetry}
      />,
    );
    expect(await failed.findByTestId('personal-keys-enroll-error')).toBeTruthy();
    expect(await failed.findByText(copy.home.personalKeysEnrollFailed)).toBeTruthy();
    await fireEvent.press(await failed.findByTestId('personal-keys-enroll-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows needs-other-phone on Home attention', async () => {
    const { findByText, findByTestId } = await renderScreen(
      <SecurityStatusCard
        attentionOnly
        keyStatus="ready"
        personalStatus="needsOtherPhone"
        recoveryStatus={undefined}
        keyHolder
        admin
        familyName="The Riveras"
        keysTestID="home-keys-status"
        personalKeysTestID="home-personal-keys-status"
        recoveryTestID="home-recovery-status"
      />,
    );
    expect(await findByTestId('home-personal-keys-status')).toBeTruthy();
    expect(await findByText(copy.home.personalKeysNeedOtherPhone)).toBeTruthy();
  });
});

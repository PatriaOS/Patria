import { fireEvent } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { InvitePreviewView } from './InvitePreviewView';

const preview = {
  family_space_name: 'The Rivera Family',
  role: 'teen' as const,
  default_circle_name: 'Household',
  expires_at: new Date().toISOString(),
  visibility_summary: 'You can see the family space and the member list.',
  inviter_display_name: 'Elena Rivera',
};

describe('InvitePreviewView', () => {
  it('shows who invited, the family, role, and visibility summary before accept', async () => {
    const { getByText } = await renderScreen(
      <InvitePreviewView
        preview={preview}
        signedIn
        busy={false}
        error={null}
        onAccept={() => undefined}
        onDecline={() => undefined}
        onSignIn={() => undefined}
        onSignUp={() => undefined}
      />,
    );

    expect(getByText(/Elena Rivera/)).toBeTruthy();
    expect(getByText(/The Rivera Family/)).toBeTruthy();
    expect(getByText(preview.visibility_summary)).toBeTruthy();
    expect(getByText(copy.invitePreview.accept)).toBeTruthy();
    expect(getByText(copy.invitePreview.decline)).toBeTruthy();
  });

  it('accepts on the first tap', async () => {
    const onAccept = jest.fn();
    const { getByText } = await renderScreen(
      <InvitePreviewView
        preview={preview}
        signedIn
        busy={false}
        error={null}
        onAccept={onAccept}
        onDecline={() => undefined}
        onSignIn={() => undefined}
        onSignUp={() => undefined}
      />,
    );
    await fireEvent.press(getByText(copy.invitePreview.accept));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});

import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { copy } from '../../lib/copy';
import { rotateFamilyKeyIfNeeded } from '../../lib/crypto/rotateFamilyKey';
import { fetchAdminMemberEmail, fetchMembers } from '../../lib/family';
import { leaveFamilySpace } from '../../lib/leaveFamily';
import { supabase } from '../../lib/supabase';
import { renderScreen } from '../../test/renderScreen';
import { MemberScreen } from './MemberScreen';

const authState = { id: 'u2' };

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: authState.id } }, loading: false }),
}));

jest.mock('../../lib/crypto/rotateFamilyKey', () => ({
  rotateFamilyKeyIfNeeded: jest.fn(async () => 'rotated'),
  homeRotationQueryKey: (spaceId: string) => ['homeRotationUi', spaceId],
  homeRotationUiFromOutcome: (outcome: string) =>
    outcome === 'failed' ? 'failed' : outcome === 'idle' ? 'hidden' : 'upToDate',
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      delete: () => ({
        eq: () => ({
          eq: async () => ({ error: null }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: async () => ({ error: null }),
        }),
      }),
    })),
  },
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
}));

jest.mock('../../lib/family', () => ({
  fetchMembers: jest.fn(),
  fetchAdminMemberEmail: jest.fn(async () => null),
}));

jest.mock('../../lib/leaveFamily', () => ({
  leaveFamilySpace: jest.fn(async () => ({ ok: true })),
}));

const members = [
  {
    id: 'm1',
    userId: 'u1',
    role: 'family_admin' as const,
    relationshipLabel: null,
    displayName: 'Test 1',
  },
  {
    id: 'm2',
    userId: 'u2',
    role: 'elder' as const,
    relationshipLabel: null,
    displayName: 'Test 2',
  },
];

describe('MemberScreen leave family', () => {
  beforeEach(() => {
    authState.id = 'u2';
    (fetchMembers as jest.Mock).mockResolvedValue(members);
    (fetchAdminMemberEmail as jest.Mock).mockResolvedValue(null);
    (leaveFamilySpace as jest.Mock).mockResolvedValue({ ok: true });
    (rotateFamilyKeyIfNeeded as jest.Mock).mockClear();
    (rotateFamilyKeyIfNeeded as jest.Mock).mockResolvedValue('rotated');
    (supabase.from as jest.Mock).mockClear();
  });

  it('lets a member leave from their own row after a destructive confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      expect(buttons?.[0]?.style).toBe('cancel');
      const leave = buttons?.find((item) => item.style === 'destructive');
      expect(leave?.text).toBe(copy.member.leave);
      leave?.onPress?.();
    });
    const { findByText } = await renderScreen(<MemberScreen userId="u2" />);
    await fireEvent.press(await findByText(copy.member.leave));
    await waitFor(() => {
      expect(leaveFamilySpace).toHaveBeenCalledWith({ spaceId: 's1', userId: 'u2' });
    });
    alertSpy.mockRestore();
  });

  it('rotates the family key after an admin confirms Remove from this family', async () => {
    authState.id = 'u1';
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const remove = buttons?.find((item) => item.style === 'destructive');
      remove?.onPress?.();
    });
    const { findByText } = await renderScreen(<MemberScreen userId="u2" />);
    await fireEvent.press(await findByText(copy.member.remove));
    await waitFor(() => {
      expect(rotateFamilyKeyIfNeeded).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: 's1',
          userId: 'u1',
          role: 'family_admin',
        }),
      );
    });
    alertSpy.mockRestore();
  });

  it('does not remove or rotate when the admin cancels Remove from this family', async () => {
    authState.id = 'u1';
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const cancel = buttons?.find((item) => item.style === 'cancel');
      cancel?.onPress?.();
    });
    const { findByText } = await renderScreen(<MemberScreen userId="u2" />);
    await fireEvent.press(await findByText(copy.member.remove));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(rotateFamilyKeyIfNeeded).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('does not show leave on someone else’s row', async () => {
    const { findByText, queryByText } = await renderScreen(<MemberScreen userId="u1" />);
    await findByText('Test 1');
    expect(queryByText(copy.member.leave)).toBeNull();
  });
});

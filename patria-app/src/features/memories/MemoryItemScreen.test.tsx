import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';

import { copy } from '../../lib/copy';
import { renderScreen } from '../../test/renderScreen';
import { MemoryItemScreen } from './MemoryItemScreen';
import { fetchCircleMemberIds, fetchMemoryItem } from './memoryApi';

jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));

jest.mock('../../lib/currentFamily', () => ({
  readCurrentFamilyId: jest.fn(async () => 's1'),
}));

jest.mock('expo-router', () => {
  const push = jest.fn();
  const replace = jest.fn();
  return {
    useRouter: () => ({ push, replace }),
    useLocalSearchParams: () => ({ itemId: 'item-1' }),
  };
});

jest.mock('./memoryApi', () => ({
  fetchMemoryItem: jest.fn(),
  fetchUploaderCircles: jest.fn(async () => [
    { id: 'hh', name: 'Household', kind: 'household' },
    { id: 'ext', name: 'Extended Family', kind: 'extended_family' },
  ]),
  fetchCircleMemberIds: jest.fn(),
  moveMemoryItem: jest.fn(async () => undefined),
  deleteMemoryItem: jest.fn(async () => undefined),
}));

const item = {
  id: 'item-1',
  familySpaceId: 's1',
  circleId: 'hh',
  circleName: 'Household',
  circleKind: 'household',
  uploaderId: 'u1',
  uploaderName: 'Elena',
  caption: 'Picnic',
  takenAt: '2024-05-01T08:30:00.000Z',
  createdAt: '2024-05-01T09:00:00.000Z',
  width: 800,
  height: 600,
  fullPath: 's1/item-1/full.jpg',
  thumbPath: 's1/item-1/thumb.jpg',
  thumbUrl: 'https://example/thumb',
  fullUrl: 'https://example/full',
  kind: 'photo' as const,
  durationSeconds: null,
  addedAutomatically: false,
  sourceHash: null,
};

describe('Memory item', () => {
  beforeEach(() => {
    (fetchMemoryItem as jest.Mock).mockResolvedValue(item);
    (fetchCircleMemberIds as jest.Mock).mockImplementation(async (circleId: string) => {
      if (circleId === 'hh') {
        return ['u1', 'u2'];
      }
      return ['u1', 'u2', 'u3'];
    });
    jest.spyOn(Alert, 'alert');
  });

  it('asks to confirm when moving to a circle that includes someone new', async () => {
    const { findByTestId } = renderScreen(<MemoryItemScreen />);
    fireEvent.press(await findByTestId('move-circle-extended_family'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        copy.memories.widenTitle,
        expect.stringMatching(/cannot see this photo/i),
        expect.any(Array),
      );
    });
  });

  it('hides Move and Delete when the viewer is not the uploader', async () => {
    (fetchMemoryItem as jest.Mock).mockResolvedValue({ ...item, uploaderId: 'other' });
    const { findByText, queryByText } = renderScreen(<MemoryItemScreen />);
    expect(await findByText('Picnic')).toBeTruthy();
    expect(queryByText(copy.memories.delete)).toBeNull();
    expect(queryByText(copy.memories.move)).toBeNull();
  });

  it('says location is not stored with this video', async () => {
    (fetchMemoryItem as jest.Mock).mockResolvedValue({
      ...item,
      kind: 'video',
      durationSeconds: 2,
      caption: null,
    });
    const { findByText, queryByText } = renderScreen(<MemoryItemScreen />);
    expect(await findByText(copy.memories.noLocationVideo)).toBeTruthy();
    expect(queryByText(copy.memories.noLocation)).toBeNull();
  });
});

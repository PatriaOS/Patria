// SECURITY REVIEW REQUIRED
import { secretsEqual, wipe } from './bytes';
import {
  unwrapPersonalKeyFromDevice,
  unwrapPersonalKeyFromRecovery,
  wrapPersonalKeyToDevice,
  wrapPersonalKeyToRecovery,
} from './personalKey';
import { randomKey32 } from './random';
import { generateDeviceKeyPair } from './x25519';

const SPACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';
const DEVICE = 'd1111111-1111-1111-1111-111111111111';

describe('personal key wraps', () => {
  it('round-trips to a device and to recovery, and refuses the wrong recipient', () => {
    const personalKey = randomKey32();
    const device = generateDeviceKeyPair();
    const recovery = generateDeviceKeyPair();
    const other = generateDeviceKeyPair();
    const wrapped = wrapPersonalKeyToDevice(personalKey, device.publicKey, {
      familySpaceId: SPACE,
      userId: USER,
      deviceId: DEVICE,
    });
    const opened = unwrapPersonalKeyFromDevice(wrapped, device.privateKey, {
      familySpaceId: SPACE,
      userId: USER,
      deviceId: DEVICE,
    });
    expect(secretsEqual(opened, personalKey)).toBe(true);
    expect(() =>
      unwrapPersonalKeyFromDevice(wrapped, other.privateKey, {
        familySpaceId: SPACE,
        userId: USER,
        deviceId: DEVICE,
      }),
    ).toThrow('unwrap failed');
    const sealed = wrapPersonalKeyToRecovery(personalKey, recovery.publicKey, SPACE, USER);
    const restored = unwrapPersonalKeyFromRecovery(sealed, recovery.privateKey, SPACE, USER);
    expect(secretsEqual(restored, personalKey)).toBe(true);
    expect(() =>
      unwrapPersonalKeyFromRecovery(sealed, other.privateKey, SPACE, USER),
    ).toThrow('unwrap failed');
    wipe(personalKey);
    wipe(opened);
    wipe(restored);
  });
});

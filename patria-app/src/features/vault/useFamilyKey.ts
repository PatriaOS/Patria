import { wipe } from '../../lib/crypto/bytes';
import { supabaseDeviceAccessGateway } from '../../lib/crypto/deviceAccess';
import { ensureDeviceIdentity } from '../../lib/crypto/deviceIdentity';
import { obtainFamilyKey } from '../../lib/crypto/keyStore';

export async function loadFamilyKeyForVault(
  userId: string,
  spaceId: string,
): Promise<Uint8Array | null> {
  const device = await ensureDeviceIdentity(userId);
  return obtainFamilyKey({
    userId,
    spaceId,
    deviceId: device.deviceId,
    privateKey: device.privateKey,
    fetchOwnWrap: supabaseDeviceAccessGateway.fetchOwnWrap,
  });
}

export function withFamilyKey<T>(
  familyKey: Uint8Array,
  run: (key: Uint8Array) => T,
): T {
  try {
    return run(familyKey);
  } finally {
    wipe(familyKey);
  }
}

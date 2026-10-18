/** expo-image-picker documents `asset.duration` in milliseconds on iOS and Android. */
export function durationSecondsFromPicker(duration: number | null | undefined): number | null {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  const rounded = Math.round(duration / 1000);
  if (rounded < 1) {
    return null;
  }
  return rounded;
}

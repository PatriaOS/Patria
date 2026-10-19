export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '');
  if (raw.length !== 6) {
    throw new Error(`Expected six-digit hex, got ${hex}`);
  }
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastPair = {
  name: string;
  foreground: string;
  background: string;
  min: number;
};

export function assertContrast(pair: ContrastPair): void {
  const ratio = contrastRatio(pair.foreground, pair.background);
  if (ratio + 1e-6 < pair.min) {
    throw new Error(
      `${pair.name}: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1 (need ${pair.min}:1)`,
    );
  }
}

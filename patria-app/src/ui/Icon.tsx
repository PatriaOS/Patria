import type { LucideIcon } from 'lucide-react-native';
import { Circle, Path, Rect, Svg } from 'react-native-svg';

// Lucide shapes drawn with react-native-svg only (no font-icon fallback).

import { stroke } from '../theme/tokens';
import { useTheme } from '../theme';
import { decorativeA11y } from './a11y';

type IconNode =
  | { tag: 'path'; d: string }
  | { tag: 'circle'; cx: number; cy: number; r: number; fillCurrent?: boolean }
  | { tag: 'rect'; x: number; y: number; width: number; height: number; rx?: number };

const ICONS: Record<string, IconNode[]> = {
  house: [
    { tag: 'path', d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' },
    {
      tag: 'path',
      d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    },
  ],
  images: [
    { tag: 'path', d: 'm22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16' },
    { tag: 'path', d: 'M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2' },
    { tag: 'circle', cx: 13, cy: 7, r: 1, fillCurrent: true },
    { tag: 'rect', x: 8, y: 2, width: 14, height: 14, rx: 2 },
  ],
  calendarHeart: [
    { tag: 'path', d: 'M12.127 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5.125' },
    {
      tag: 'path',
      d: 'M14.62 17.8A2.25 2.25 0 1 1 18 14.836a2.25 2.25 0 1 1 3.38 2.966l-2.626 2.856a.998.998 0 0 1-1.507 0z',
    },
    { tag: 'path', d: 'M16 2v3' },
    { tag: 'path', d: 'M3 9h18' },
    { tag: 'path', d: 'M8 2v3' },
  ],
  lock: [
    { tag: 'rect', x: 3, y: 11, width: 18, height: 11, rx: 2 },
    { tag: 'path', d: 'M7 11V7a5 5 0 0 1 10 0v4' },
  ],
  users: [
    { tag: 'path', d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' },
    { tag: 'path', d: 'M16 3.128a4 4 0 0 1 0 7.744' },
    { tag: 'path', d: 'M22 21v-2a4 4 0 0 0-3-3.87' },
    { tag: 'circle', cx: 9, cy: 7, r: 4 },
  ],
  settings: [
    {
      tag: 'path',
      d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    },
    { tag: 'circle', cx: 12, cy: 12, r: 3 },
  ],
  play: [
    {
      tag: 'path',
      d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z',
    },
  ],
  check: [{ tag: 'path', d: 'M20 6 9 17l-5-5' }],
  plus: [
    { tag: 'path', d: 'M5 12h14' },
    { tag: 'path', d: 'M12 5v14' },
  ],
  sparkles: [
    {
      tag: 'path',
      d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    },
    { tag: 'path', d: 'M20 2v4' },
    { tag: 'path', d: 'M22 4h-4' },
    { tag: 'circle', cx: 4, cy: 20, r: 2 },
  ],
};

ICONS.home = ICONS.house;
ICONS.memories = ICONS.images;
ICONS.sync = ICONS.calendarHeart;
ICONS.vault = ICONS.lock;
ICONS.family = ICONS.users;

type Props = {
  icon: LucideIcon;
  name?: string;
  color?: string;
  size?: number;
  decorative?: boolean;
};

function iconKey(icon: LucideIcon, name?: string): string {
  const raw = name ?? icon.displayName ?? '';
  return raw.replace(/Icon$/, '').replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

export function Icon({ icon, name, color, size = 22, decorative = true }: Props) {
  const { colors } = useTheme();
  const ink = color ?? colors.text;
  const nodes = ICONS[iconKey(icon, name)] ?? [];
  const a11y = decorative ? decorativeA11y : {};

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...a11y}>
      {nodes.map((node, index) => {
        const shared = {
          stroke: ink,
          strokeWidth: stroke.icon,
          strokeLinecap: 'round' as const,
          strokeLinejoin: 'round' as const,
        };
        if (node.tag === 'circle') {
          return (
            <Circle
              key={String(index)}
              {...shared}
              cx={node.cx}
              cy={node.cy}
              r={node.r}
              fill={node.fillCurrent ? ink : 'none'}
            />
          );
        }
        if (node.tag === 'rect') {
          return (
            <Rect
              key={String(index)}
              {...shared}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={node.rx}
              fill="none"
            />
          );
        }
        return <Path key={String(index)} {...shared} d={node.d} fill="none" />;
      })}
    </Svg>
  );
}

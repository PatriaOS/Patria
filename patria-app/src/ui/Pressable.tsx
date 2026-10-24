import { useRef } from 'react';
import { Pressable as RNPressable, type PressableProps } from 'react-native';

type Props = PressableProps;

const REENTRY_MS = 300;

export function Pressable({ disabled = false, onPress, accessibilityState, ...rest }: Props) {
  const inactive = Boolean(disabled);
  const lastPressAt = useRef(0);

  return (
    <RNPressable
      {...rest}
      collapsable={false}
      // Never pass native disabled. RN 0.88 can leave enabled=false after a
      // true → false flip until a later layout (facebook/react-native#56777).
      // Gesture Handler is not used here: it can fire onPress twice (select then
      // unselect a recovery row) and drop the first tab tap after addMedia.
      disabled={false}
      accessibilityState={{ ...accessibilityState, disabled: inactive }}
      onPress={(event) => {
        if (inactive) {
          return;
        }
        const now = Date.now();
        if (now - lastPressAt.current < REENTRY_MS) {
          return;
        }
        lastPressAt.current = now;
        onPress?.(event);
      }}
    />
  );
}

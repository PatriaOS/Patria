import { Pressable as GesturePressable, type PressableProps } from 'react-native-gesture-handler';

type Props = PressableProps;

export function Pressable({ disabled = false, onPress, accessibilityState, ...rest }: Props) {
  const inactive = Boolean(disabled);
  return (
    <GesturePressable
      {...rest}
      collapsable={false}
      // Always pass a boolean. RN 0.88 can leave native enabled=false after a
      // true → undefined disabled flip (box-none until a later layout). Gesture
      // Handler receives the tap after a keyboard, permission sheet, or push.
      disabled={inactive}
      accessibilityState={{ ...accessibilityState, disabled: inactive }}
      onPress={(event) => {
        if (inactive) {
          return;
        }
        onPress?.(event);
      }}
    />
  );
}

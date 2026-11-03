import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme';
import { Pressable } from './Pressable';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
  contentStyle?: StyleProp<ViewStyle>;
};

/** Bottom sheet with grab handle; closes on swipe down, backdrop tap, or back. */
export function SheetModal({
  visible,
  onClose,
  children,
  testID,
  accessibilityLabel,
  contentStyle,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(0));

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          if (gesture.dy > 0) {
            translateY.setValue(gesture.dy);
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 72 || gesture.vy > 0.85) {
            Animated.timing(translateY, {
              toValue: 480,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              translateY.setValue(0);
              onClose();
            });
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        },
      }),
    [onClose, translateY],
  );

  useEffect(() => {
    if (visible) {
      translateY.setValue(0);
    }
  }, [visible, translateY]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root} testID={testID}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? 'Close'}
          onPress={onClose}
          style={styles.backdrop}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
              paddingBottom: insets.bottom + space.md,
              transform: [{ translateY }],
            },
            contentStyle,
          ]}
          {...pan.panHandlers}
        >
          <View
            style={styles.handleHit}
            accessibilityRole="adjustable"
            accessibilityLabel="Drag down to close"
            testID={testID ? `${testID}-handle` : undefined}
          >
            <View style={[styles.handle, { backgroundColor: colors.hairline }]} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
  sheet: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderTopWidth: 1,
    paddingHorizontal: space.card,
    paddingBottom: space.card,
    gap: space.sm,
  },
  handleHit: {
    alignItems: 'center',
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
});

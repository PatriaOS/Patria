import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, ButtonStack, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme';
import { radius, space } from '../../theme/tokens';

type Props = {
  visible: boolean;
  onSetUp: () => void;
  onLater: () => void;
};

/** Bottom sheet after sign in for recovery / printed code only. */
export function RecoveryReminderSheet({ visible, onSetUp, onLater }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!visible) {
    return null;
  }
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onLater}>
      <View style={styles.root} testID="recovery-reminder-sheet">
        <View style={styles.backdrop} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
              paddingBottom: insets.bottom + space.md,
            },
          ]}
        >
          <Title>{copy.home.recoveryReminderTitle}</Title>
          <Body>{copy.home.recoveryReminderBody}</Body>
          <ButtonStack>
            <Button
              label={copy.home.recoveryReminderAction}
              testID="recovery-reminder-set-up"
              onPress={onSetUp}
            />
            <Button
              label={copy.home.recoveryReminderLater}
              variant="secondary"
              testID="recovery-reminder-later"
              onPress={onLater}
            />
          </ButtonStack>
        </View>
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
    padding: space.card,
    gap: space.sm,
  },
});

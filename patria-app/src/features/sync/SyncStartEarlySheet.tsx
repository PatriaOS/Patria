import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, ButtonStack, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { useTheme } from '../../theme';
import { radius, space } from '../../theme/tokens';
import { fillTemplate } from './syncLabels';

type Props = {
  visible: boolean;
  weekday: string;
  whenLabel: string;
  circleName: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirm before starting a Sync that is still days away. */
export function SyncStartEarlySheet({
  visible,
  weekday,
  whenLabel,
  circleName,
  onConfirm,
  onCancel,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!visible) {
    return null;
  }
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.root} testID="start-early-sheet">
        <Pressable
          testID="start-early-backdrop"
          accessibilityRole="button"
          accessibilityLabel={copy.sync.startEarlyNotYet}
          onPress={onCancel}
          style={styles.backdrop}
        />
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
          <Title>
            {fillTemplate(copy.sync.startEarlyTitle, { weekday })}
          </Title>
          <Body>
            {fillTemplate(copy.sync.startEarlyBody, {
              when: whenLabel,
              circle: circleName,
            })}
          </Body>
          <ButtonStack>
            <Button
              label={copy.sync.startEarlyConfirm}
              testID="start-early-confirm"
              onPress={onConfirm}
            />
            <Button
              label={copy.sync.startEarlyNotYet}
              variant="secondary"
              testID="start-early-not-yet"
              onPress={onCancel}
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

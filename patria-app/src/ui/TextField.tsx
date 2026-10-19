import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { radius, space, typeScale } from '../theme/tokens';
import { useTheme } from '../theme';
import { Caption, Small } from './Text';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export function TextField({ label, error, ...inputProps }: Props) {
  const { colors, fontFamily, previewScale, maxFontSizeMultiplier } = useTheme();
  return (
    <View style={styles.field}>
      <Small tone="muted">{label}</Small>
      <TextInput
        {...inputProps}
        testID={inputProps.testID ?? testIdFromLabel(label)}
        accessibilityLabel={label}
        allowFontScaling
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            fontFamily: fontFamily('body'),
            fontSize: typeScale.body.size * previewScale,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.hairline,
            color: colors.text,
          },
        ]}
        textAlignVertical="center"
      />
      {error ? (
        <Caption tone="danger" accessibilityRole="text">
          {error}
        </Caption>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: space.xs,
  },
  input: {
    borderRadius: radius.tile,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 52,
  },
});

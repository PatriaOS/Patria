import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { testIdFromLabel } from '../lib/testId';
import { radius, space, typeScale } from '../theme/tokens';
import { useTheme } from '../theme';
import { Caption, Small } from './Text';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export const TextField = forwardRef<TextInputInstance, Props>(function TextField(
  { label, error, ...inputProps },
  ref,
) {
  const { colors, fontFamily, previewScale, maxFontSizeMultiplier } = useTheme();
  return (
    <View style={styles.field}>
      <Small tone="muted">{label}</Small>
      <TextInput
        {...inputProps}
        ref={ref}
        testID={inputProps.testID ?? testIdFromLabel(label)}
        accessibilityLabel={label}
        allowFontScaling
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          inputProps.multiline ? styles.multiline : null,
          {
            fontFamily: fontFamily('body'),
            fontSize: typeScale.body.size * previewScale,
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.hairline,
            color: colors.text,
          },
        ]}
        textAlignVertical={inputProps.multiline ? 'top' : 'center'}
      />
      {error ? (
        <Caption tone="danger" accessibilityRole="text">
          {error}
        </Caption>
      ) : null}
    </View>
  );
});

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
  multiline: {
    minHeight: 140,
    paddingTop: space.sm,
  },
});

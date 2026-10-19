import { type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { testIdFromLabel } from '../lib/testId';
import { spacing, textScale, type, useTheme } from '../theme';
import { screenSafeEdges } from '../ui/screenEdges';

export function AppText({ children, ...rest }: ComponentProps<typeof Text>) {
  return (
    <Text
      {...rest}
      allowFontScaling
      maxFontSizeMultiplier={textScale.maxFontSizeMultiplier}
    >
      {children}
    </Text>
  );
}

export function AppTextInput(props: TextInputProps) {
  return (
    <TextInput
      {...props}
      allowFontScaling
      maxFontSizeMultiplier={textScale.maxFontSizeMultiplier}
    />
  );
}

type ScreenProps = {
  children: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  withHeader?: boolean;
  withTabBar?: boolean;
  keyboardAware?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
};

export function Screen({
  children,
  accessibilityLabel,
  testID,
  withHeader = false,
  withTabBar = false,
  keyboardAware = false,
  refreshing = false,
  onRefresh,
}: ScreenProps) {
  const { colors } = useTheme();
  const scroll = (
    <ScrollView
      contentContainerStyle={[styles.scroll, { backgroundColor: colors.background }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      alwaysBounceVertical={Boolean(onRefresh)}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={screenSafeEdges({ withHeader, withTabBar })}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={withHeader ? 64 : 0}
        >
          {scroll}
        </KeyboardAvoidingView>
      ) : (
        scroll
      )}
    </SafeAreaView>
  );
}

type TitleProps = { children: ReactNode; testID?: string };

export function Title({ children, testID }: TitleProps) {
  const { colors } = useTheme();
  return (
    <AppText testID={testID} style={[styles.title, { color: colors.primary }]}>
      {children}
    </AppText>
  );
}

export function Body({ children, testID }: TitleProps) {
  const { colors } = useTheme();
  return (
    <AppText testID={testID} style={[styles.body, { color: colors.text }]}>
      {children}
    </AppText>
  );
}

export function Muted({ children, testID }: TitleProps) {
  const { colors } = useTheme();
  return (
    <AppText testID={testID} style={[styles.muted, { color: colors.textMuted }]}>
      {children}
    </AppText>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || busy;
  const fill =
    variant === 'danger' ? colors.dangerFill : variant === 'secondary' ? 'transparent' : colors.primary;
  const labelColor = variant === 'secondary' ? colors.primary : colors.onPrimary;
  return (
    <Pressable
      testID={testID ?? testIdFromLabel(label)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: fill,
          borderColor: colors.primary,
          borderWidth: variant === 'secondary' ? 1 : 0,
        },
        inactive && styles.buttonDisabled,
        pressed && !inactive && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <AppText style={[styles.buttonLabel, { color: labelColor }]}>{label}</AppText>
      )}
    </Pressable>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  error?: string;
};

export function Field({ label, error, ...inputProps }: FieldProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <AppText style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</AppText>
      <AppTextInput
        {...inputProps}
        testID={inputProps.testID ?? testIdFromLabel(label)}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            borderColor: colors.hairline,
            color: colors.text,
          },
        ]}
        textAlignVertical="center"
      />
      {error ? (
        <AppText style={[styles.fieldError, { color: colors.danger }]}>{error}</AppText>
      ) : null}
    </View>
  );
}

type StatusProps = { message: string };

export function LoadingState({ message }: StatusProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.status} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator color={colors.primary} />
      <AppText style={[styles.muted, { color: colors.textMuted }]}>{message}</AppText>
    </View>
  );
}

export function ErrorState({ message }: StatusProps) {
  const { colors } = useTheme();
  return (
    <AppText style={[styles.fieldError, { color: colors.danger }]} accessibilityRole="alert">
      {message}
    </AppText>
  );
}

export function EmptyState({ message }: StatusProps) {
  const { colors } = useTheme();
  return <AppText style={[styles.muted, { color: colors.textMuted }]}>{message}</AppText>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  title: {
    ...type.heading,
  },
  body: {
    ...type.body,
  },
  muted: {
    ...type.caption,
  },
  button: {
    borderRadius: 28,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    ...type.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    ...type.caption,
  },
  input: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 52,
  },
  fieldError: {
    ...type.caption,
  },
  status: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
});

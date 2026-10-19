import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button, ErrorState, Field, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';

const schema = z.object({
  email: z.string().trim().min(3),
  password: z.string().min(6),
});

type FormValues = z.infer<typeof schema>;

export function SignInScreen() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(copy.auth.signInFailed);
      return;
    }
    router.replace(routes.gate);
  });

  return (
    <Screen
      accessibilityLabel={copy.auth.signInTitle}
      testID="screen-sign-in"
      withHeader
      keyboardAware
    >
      <Title>{copy.auth.signInTitle}</Title>
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <Field
            label={copy.auth.emailLabel}
            placeholder={copy.auth.emailPlaceholder}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <Field
            label={copy.auth.passwordLabel}
            placeholder={copy.auth.passwordPlaceholder}
            secureTextEntry
            textContentType="password"
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={() => void onSubmit()}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      {formError ? <ErrorState message={formError} /> : null}
      <Button
        label={copy.auth.signInSubmit}
        onPress={onSubmit}
        disabled={formState.isSubmitting}
      />
      <Button
        label={copy.auth.needAccount}
        variant="secondary"
        onPress={() => router.push('/(signed-out)/sign-up')}
      />
    </Screen>
  );
}

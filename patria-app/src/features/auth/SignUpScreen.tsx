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
  name: z.string().trim().min(1),
  email: z.string().trim().min(3),
  password: z.string().min(6),
});

type FormValues = z.infer<typeof schema>;

export function SignUpScreen() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { display_name: values.name } },
    });
    if (error) {
      setFormError(copy.auth.signUpFailed);
      return;
    }
    if (data.session) {
      router.replace(routes.gate);
      return;
    }
    router.replace('/(signed-out)/verify');
  });

  return (
    <Screen
      accessibilityLabel={copy.auth.signUpTitle}
      testID="screen-sign-up"
      withHeader
      keyboardAware
    >
      <Title>{copy.auth.signUpTitle}</Title>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <Field
            label={copy.auth.nameLabel}
            placeholder={copy.auth.namePlaceholder}
            autoCapitalize="words"
            textContentType="name"
            autoComplete="name"
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
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
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="go"
            onSubmitEditing={() => void onSubmit()}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      {formError ? <ErrorState message={formError} /> : null}
      <Button
        label={copy.auth.signUpSubmit}
        onPress={onSubmit}
        disabled={formState.isSubmitting}
      />
      <Button
        label={copy.auth.haveAccount}
        variant="secondary"
        onPress={() => router.push('/(signed-out)/sign-in')}
      />
    </Screen>
  );
}

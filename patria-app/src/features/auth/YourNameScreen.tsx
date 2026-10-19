import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button, ErrorState, Field, Screen, Title } from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { routes } from '../../lib/navigation';
import { logFailedAction } from '../../lib/devLog';
import { ownDisplayNameQueryKey } from '../../lib/ownDisplayName';
import { queryClient } from '../../lib/queryClient';
import { supabase } from '../../lib/supabase';

const schema = z.object({
  name: z.string().trim().min(1),
});

type FormValues = z.infer<typeof schema>;

export function YourNameScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { session } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!session?.user.id) {
      setFormError(copy.common.error);
      return;
    }
    setFormError(null);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: values.name, updated_at: new Date().toISOString() })
      .eq('id', session.user.id);
    if (error) {
      logFailedAction(error);
      setFormError(copy.common.error);
      return;
    }
    queryClient.setQueryData(ownDisplayNameQueryKey(session.user.id), values.name);
    await queryClient.invalidateQueries({ queryKey: ownDisplayNameQueryKey(session.user.id) });
    router.replace(routes.gate);
  });

  return (
    <Screen withHeader={navigation.canGoBack()}>
      <Title>{copy.auth.nameLabel}</Title>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <Field
            label={copy.auth.nameLabel}
            placeholder={copy.auth.namePlaceholder}
            autoCapitalize="words"
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      {formError ? <ErrorState message={formError} /> : null}
      <Button
        label={copy.common.save}
        onPress={onSubmit}
        disabled={formState.isSubmitting}
        busy={formState.isSubmitting}
      />
    </Screen>
  );
}

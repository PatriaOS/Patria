import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Body, Button, ErrorState, Field, Muted, Screen, Title } from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { copy } from '../../lib/copy';
import { readCurrentFamilyId } from '../../lib/currentFamily';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';

const schema = z.object({
  name: z.string().trim().min(1),
  dateOfBirth: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function AddChildScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', dateOfBirth: '' },
  });

  useEffect(() => {
    void readCurrentFamilyId().then(setSpaceId);
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    if (!session || !spaceId) {
      return;
    }
    setFormError(null);
    const { data, error } = await supabase
      .from('child_profiles')
      .insert({
        family_space_id: spaceId,
        display_name: values.name,
        date_of_birth: values.dateOfBirth ? values.dateOfBirth : null,
        created_by: session.user.id,
      })
      .select('id')
      .single();
    if (error || !data) {
      logFailedAction(error);
      setFormError(copy.child.failed);
      return;
    }
    router.replace(routes.family);
  });

  return (
    <Screen accessibilityLabel={copy.child.title} withHeader>
      <Title>{copy.child.title}</Title>
      <Body>{copy.child.body}</Body>
      <Muted>{copy.child.noEmail}</Muted>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <Field
            label={copy.child.nameLabel}
            placeholder={copy.child.namePlaceholder}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      <Controller
        control={control}
        name="dateOfBirth"
        render={({ field }) => (
          <Field
            label={copy.child.birthLabel}
            placeholder="2018-04-12"
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      {formError ? <ErrorState message={formError} /> : null}
      <Button
        label={copy.child.submit}
        onPress={onSubmit}
        disabled={formState.isSubmitting}
      />
    </Screen>
  );
}

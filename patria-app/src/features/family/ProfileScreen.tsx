import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Banner, Body, Button, ErrorState, Field, LoadingState, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { logFailedAction } from '../../lib/devLog';
import { isValidYmd } from '../letters/letterDates';
import {
  fetchProfileDateOfBirth,
  updateOwnDateOfBirth,
} from '../letters/letterApi';
import { useCurrentFamily } from './useCurrentFamily';

const schema = z.object({
  dateOfBirth: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidYmd(value), { message: 'invalid' }),
});

type FormValues = z.infer<typeof schema>;

export function ProfileScreen() {
  const queryClient = useQueryClient();
  const { userId } = useCurrentFamily();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dobQuery = useQuery({
    queryKey: ['ownDateOfBirth', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchProfileDateOfBirth(userId!),
  });

  const { control, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: { dateOfBirth: dobQuery.data ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!userId) {
      return;
    }
    setFormError(null);
    setSaved(false);
    try {
      const next = values.dateOfBirth.trim() ? values.dateOfBirth.trim() : null;
      await updateOwnDateOfBirth(userId, next);
      await queryClient.invalidateQueries({ queryKey: ['ownDateOfBirth', userId] });
      reset({ dateOfBirth: next ?? '' });
      setSaved(true);
    } catch (error) {
      logFailedAction(error);
      setFormError(copy.profile.saveFailed);
    }
  });

  if (!userId || dobQuery.isLoading) {
    return (
      <Screen withHeader testID="screen-profile" accessibilityLabel={copy.profile.title}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  if (dobQuery.isError) {
    return (
      <Screen withHeader testID="screen-profile" accessibilityLabel={copy.profile.title}>
        <ErrorState message={copy.common.error} />
      </Screen>
    );
  }

  return (
    <Screen withHeader testID="screen-profile" accessibilityLabel={copy.profile.title}>
      <Title>{copy.profile.title}</Title>
      <Body>{copy.profile.body}</Body>
      <Controller
        control={control}
        name="dateOfBirth"
        render={({ field, fieldState }) => (
          <Field
            label={copy.profile.birthLabel}
            placeholder={copy.profile.birthPlaceholder}
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error ? copy.profile.birthInvalid : undefined}
            testID="profile-birthday"
            accessibilityLabel={copy.profile.birthLabel}
          />
        )}
      />
      <Body>{copy.profile.birthHint}</Body>
      {formError ? <ErrorState message={formError} /> : null}
      {saved ? <Banner message={copy.profile.saved} tone="info" /> : null}
      <Button
        label={copy.profile.save}
        onPress={() => void onSubmit()}
        busy={formState.isSubmitting}
        testID="profile-save"
      />
    </Screen>
  );
}

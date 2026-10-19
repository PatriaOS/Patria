import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import {
  Body,
  Button,
  ChoiceChip,
  ErrorState,
  Field,
  Muted,
  Screen,
  Title,
} from '../../ui';
import { useAuth } from '../../lib/auth-context';
import { signOutAndGoWelcome } from '../../lib/authSession';
import { ensureKeysForOpenFamily } from '../../lib/crypto/familyCeremony';
import { logFailedAction } from '../../lib/devLog';
import { copy } from '../../lib/copy';
import { writeCurrentFamilyId } from '../../lib/currentFamily';
import { routes } from '../../lib/navigation';
import { supabase } from '../../lib/supabase';
import { testIdFromLabel } from '../../lib/testId';
import { space } from '../../theme/tokens';
import { PasteInviteField } from '../invites/PasteInviteField';

const RELATIONSHIPS = ['mum', 'dad', 'grandparent', 'guardian'] as const;

const schema = z.object({
  name: z.string().trim().min(1),
  relationship: z.enum(RELATIONSHIPS),
});

type FormValues = z.infer<typeof schema>;

export function CreateFamilyScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const navigation = useNavigation();
  const withHeader = navigation.canGoBack();
  const [formError, setFormError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', relationship: 'mum' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { data, error } = await supabase.rpc('create_family_space', {
      p_name: values.name,
      p_relationship_label: copy.relationships[values.relationship],
    });
    if (error || !data) {
      logFailedAction(error);
      setFormError(copy.createFamily.failed);
      return;
    }
    const spaceId = String(data);
    await writeCurrentFamilyId(spaceId);
    const userId = session?.user.id;
    if (userId) {
      await ensureKeysForOpenFamily({
        spaceId,
        userId,
        role: 'family_admin',
      });
    }
    router.replace('/(signed-in)/ready');
  });

  return (
    <Screen
      testID="screen-create-family"
      accessibilityLabel={copy.createFamily.title}
      withHeader={withHeader}
    >
      <Title>{copy.createFamily.title}</Title>
      <Body>{copy.createFamily.subtitle}</Body>
      <PasteInviteField onOpen={(token) => router.push(routes.inviteAccept(token))} />
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <Field
            label={copy.createFamily.spaceNameLabel}
            placeholder={copy.createFamily.spaceNamePlaceholder}
            value={field.value}
            onChangeText={field.onChange}
          />
        )}
      />
      <Muted>{copy.createFamily.relationshipLabel}</Muted>
      <Controller
        control={control}
        name="relationship"
        render={({ field }) => (
          <View style={styles.chips}>
            {RELATIONSHIPS.map((key) => {
              const label = copy.relationships[key];
              return (
                <ChoiceChip
                  key={key}
                  testID={`relationship-${testIdFromLabel(label)}`}
                  label={label}
                  selected={field.value === key}
                  onPress={() => field.onChange(key)}
                />
              );
            })}
          </View>
        )}
      />
      {formError ? <ErrorState message={formError} /> : null}
      <Button
        label={copy.createFamily.submit}
        onPress={onSubmit}
        disabled={formState.isSubmitting}
        busy={formState.isSubmitting}
      />
      <Muted>{copy.createFamily.privacy}</Muted>
      <Button
        label={copy.auth.signOut}
        variant="secondary"
        busy={signingOut}
        onPress={() => {
          void (async () => {
            setSigningOut(true);
            try {
              await signOutAndGoWelcome({
                signOut: () => supabase.auth.signOut(),
                replace: (href) => router.replace(href),
              });
            } finally {
              setSigningOut(false);
            }
          })();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});

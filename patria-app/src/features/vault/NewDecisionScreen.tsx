import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Keyboard, type TextInputInstance } from 'react-native';
import { z } from 'zod';

import { Button, Caption, ErrorState, Field, LoadingState, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { randomUuid } from '../../lib/crypto/random';
import { clearVaultDraft, loadVaultDraft, saveVaultDraft } from '../../lib/crypto/vaultDrafts';
import { openVaultDecision, sealVaultDecision } from '../../lib/crypto/vaultEnvelope';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { isVaultWriterRole } from '../../lib/roles';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { loadFamilyKeyForVault, withFamilyKey } from './useFamilyKey';
import {
  fetchFamilyKeyEpoch,
  fetchVaultEntries,
  insertVaultEntry,
  updateVaultEntry,
} from './vaultApi';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  for: z.string().trim().max(200),
  body: z.string().trim().min(1).max(20000),
});

type FormValues = z.infer<typeof schema>;

export function NewDecisionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ parentId?: string; entryId?: string }>();
  const parentId = typeof params.parentId === 'string' ? params.parentId : undefined;
  const entryId = typeof params.entryId === 'string' ? params.entryId : undefined;
  const { userId, spaceId, current } = useCurrentFamily();
  const [formError, setFormError] = useState<string | null>(null);
  const [ready, setReady] = useState(!entryId);
  const forRef = useRef<TextInputInstance>(null);
  const whyRef = useRef<TextInputInstance>(null);
  const { control, handleSubmit, getValues, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', for: '', body: '' },
  });
  const isRootDraft = !parentId && !entryId;

  const epochQuery = useQuery({
    queryKey: ['familyKeyEpoch', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchFamilyKeyEpoch(spaceId as string),
  });

  useEffect(() => {
    if (!userId || !spaceId || entryId) {
      return;
    }
    if (!isRootDraft) {
      return;
    }
    void loadVaultDraft(userId, spaceId).then((draft) => {
      if (draft) {
        reset(draft);
      }
    });
  }, [userId, spaceId, entryId, isRootDraft, reset]);

  useEffect(() => {
    if (!userId || !spaceId || !entryId) {
      return;
    }
    void (async () => {
      try {
        const rows = await fetchVaultEntries(spaceId);
        const row = rows.find((item) => item.id === entryId);
        if (!row) {
          setFormError(copy.common.error);
          return;
        }
        const familyKey = await loadFamilyKeyForVault(userId, spaceId);
        if (!familyKey) {
          setFormError(copy.vault.noKey);
          return;
        }
        const content = withFamilyKey(familyKey, (key) =>
          openVaultDecision(key, row.sealed, {
            familySpaceId: row.familySpaceId,
            entryId: row.id,
            version: row.version,
            authorId: row.authorId,
            keyEpoch: row.keyEpoch,
          }),
        );
        reset(content);
      } catch (error) {
        logFailedAction(error);
        setFormError(copy.vault.openFailed);
      } finally {
        setReady(true);
      }
    })();
  }, [userId, spaceId, entryId, reset]);

  const persistDraft = () => {
    if (!userId || !spaceId || !isRootDraft) {
      return;
    }
    const values = getValues();
    if (!values.title && !values.body && !values.for) {
      return;
    }
    void saveVaultDraft(userId, spaceId, {
      title: values.title,
      body: values.body,
      for: values.for,
    });
  };

  const onSave = handleSubmit(async (form) => {
    Keyboard.dismiss();
    try {
      if (!userId || !spaceId || !isVaultWriterRole(current?.role)) {
        setFormError(copy.vault.saveFailed);
        return;
      }
      const epoch = epochQuery.data ?? (await fetchFamilyKeyEpoch(spaceId));
      if (epoch == null) {
        setFormError(copy.vault.saveFailed);
        return;
      }
      setFormError(null);
      const id = entryId ?? randomUuid();
      const familyKey = await loadFamilyKeyForVault(userId, spaceId);
      if (!familyKey) {
        setFormError(copy.vault.noKey);
        return;
      }
      const existing = entryId
        ? (await fetchVaultEntries(spaceId)).find((row) => row.id === entryId)
        : undefined;
      const version = existing ? existing.version + 1 : 1;
      const sealed = withFamilyKey(familyKey, (key) =>
        sealVaultDecision(key, form, {
          familySpaceId: spaceId,
          entryId: id,
          version,
          authorId: existing?.authorId ?? userId,
          keyEpoch: epoch,
        }),
      );
      if (existing) {
        await updateVaultEntry({
          id,
          expectedVersion: existing.version,
          keyEpoch: epoch,
          sealed,
        });
      } else {
        await insertVaultEntry({
          id,
          familySpaceId: spaceId,
          authorId: userId,
          parentEntryId: parentId ?? null,
          keyEpoch: epoch,
          sealed,
        });
      }
      if (isRootDraft) {
        await clearVaultDraft(userId, spaceId);
      }
      void queryClient.invalidateQueries({ queryKey: ['vaultEntries', spaceId] });
      if (parentId) {
        router.replace(routes.vaultEntry(parentId));
        return;
      }
      if (entryId) {
        router.replace(routes.vaultEntry(entryId));
        return;
      }
      router.replace(routes.vault);
    } catch (error) {
      logFailedAction(error);
      const message =
        error instanceof Error && error.message === 'too large'
          ? copy.vault.tooLarge
          : copy.vault.saveFailed;
      setFormError(message);
    }
  });

  const onDiscard = async () => {
    if (userId && spaceId && isRootDraft) {
      await clearVaultDraft(userId, spaceId);
    }
    router.back();
  };

  if (!ready) {
    return (
      <Screen withHeader accessibilityLabel={copy.vault.newDecision}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }

  return (
    <Screen withHeader keyboardAware accessibilityLabel={copy.vault.newDecision}>
      <Title>{parentId ? copy.vault.followUp : copy.vault.newDecision}</Title>
      <Caption>{copy.vault.lockNote}</Caption>
      <Controller
        control={control}
        name="title"
        render={({ field, fieldState }) => (
          <Field
            label={copy.vault.titleLabel}
            placeholder={copy.vault.titlePlaceholder}
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              persistDraft();
            }}
            error={fieldState.error ? copy.vault.titleLabel : undefined}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => forRef.current?.focus()}
          />
        )}
      />
      <Controller
        control={control}
        name="for"
        render={({ field }) => (
          <Field
            ref={forRef}
            label={copy.vault.forLabel}
            placeholder={copy.vault.forPlaceholder}
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              persistDraft();
            }}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => whyRef.current?.focus()}
          />
        )}
      />
      <Controller
        control={control}
        name="body"
        render={({ field, fieldState }) => (
          <Field
            ref={whyRef}
            label={copy.vault.bodyLabel}
            placeholder={copy.vault.bodyPlaceholder}
            value={field.value}
            onChangeText={(text) => {
              field.onChange(text);
              persistDraft();
            }}
            multiline
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => void onSave()}
            error={fieldState.error ? copy.vault.bodyLabel : undefined}
          />
        )}
      />
      {formError ? <ErrorState message={formError} /> : null}
      <Button
        label={copy.vault.save}
        onPress={() => void onSave()}
        busy={formState.isSubmitting}
        disabled={epochQuery.data == null}
      />
      {isRootDraft ? (
        <Button label={copy.vault.discard} variant="ghost" onPress={() => void onDiscard()} />
      ) : null}
    </Screen>
  );
}

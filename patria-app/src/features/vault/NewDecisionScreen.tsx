import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Keyboard, View, type TextInputInstance } from 'react-native';
import { z } from 'zod';

import { Button, Caption, ChoiceChip, ErrorState, Field, LoadingState, Screen, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { wipe } from '../../lib/crypto/bytes';
import { personalKeyNeedsOtherPhone } from '../../lib/crypto/keyStore';
import { randomUuid } from '../../lib/crypto/random';
import {
  clearVaultDraft,
  loadVaultDraft,
  loadVaultDraftAudio,
  saveVaultDraft,
  saveVaultDraftAudio,
} from '../../lib/crypto/vaultDrafts';
import type { VaultDecisionContent, VaultVisibility } from '../../lib/crypto/vaultEnvelope';
import { logFailedAction } from '../../lib/devLog';
import { routes } from '../../lib/navigation';
import { isVaultWriterRole } from '../../lib/roles';
import { useCurrentFamily } from '../family/useCurrentFamily';
import { VoiceNoteField, type VoiceDraft } from './VoiceNoteField';
import { loadFamilyKeyForVault } from './useFamilyKey';
import { openVaultEntryContent } from './vaultOpen';
import { persistVaultDecision, prepareVaultAudio } from './vaultSave';
import { fetchFamilyKeyEpoch, fetchVaultEntries, type VaultEntryRow } from './vaultApi';
import { loadPersonalKeyIfPresent } from '../../lib/crypto/personalKey';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  for: z.string().trim().max(200),
  body: z.string().trim().min(1).max(20000),
});

type FormValues = z.infer<typeof schema>;

function confirmVisibilityChange(
  next: VaultVisibility,
  onConfirm: () => void,
): void {
  if (next === 'private') {
    Alert.alert(copy.vault.onlyMe, copy.vault.switchToOnlyMe, [
      { text: copy.common.cancel, style: 'cancel' },
      { text: copy.common.continue, onPress: onConfirm },
    ]);
    return;
  }
  Alert.alert(copy.vault.family, copy.vault.switchToFamily, [
    { text: copy.common.cancel, style: 'cancel' },
    { text: copy.common.continue, onPress: onConfirm },
  ]);
}

export function NewDecisionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ parentId?: string; entryId?: string }>();
  const parentId = typeof params.parentId === 'string' ? params.parentId : undefined;
  const entryIdParam = typeof params.entryId === 'string' ? params.entryId : undefined;
  const { userId, spaceId, current } = useCurrentFamily();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(!entryIdParam);
  const [visibility, setVisibility] = useState<VaultVisibility>('family');
  const [draftId] = useState(() => entryIdParam ?? randomUuid());
  const [existing, setExisting] = useState<VaultEntryRow | undefined>();
  const [children, setChildren] = useState<{ row: VaultEntryRow; content: VaultDecisionContent }[]>(
    [],
  );
  const [audio, setAudio] = useState<VaultDecisionContent['audio']>();
  const [audioCiphertext, setAudioCiphertext] = useState<Uint8Array | null>(null);
  const [previousAudioId, setPreviousAudioId] = useState<string | null>(null);
  const forRef = useRef<TextInputInstance>(null);
  const whyRef = useRef<TextInputInstance>(null);
  const { control, getValues, reset, setError: setFieldError } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', for: '', body: '' },
  });
  const existingRef = useRef(existing);
  existingRef.current = existing;
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const audioCiphertextRef = useRef(audioCiphertext);
  audioCiphertextRef.current = audioCiphertext;
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const isRootDraft = !parentId && !entryIdParam;
  const canChangeVisibility = !parentId;

  const epochQuery = useQuery({
    queryKey: ['familyKeyEpoch', spaceId],
    enabled: Boolean(spaceId),
    queryFn: () => fetchFamilyKeyEpoch(spaceId as string),
  });

  useEffect(() => {
    if (!userId || !spaceId || entryIdParam) {
      return;
    }
    if (!isRootDraft) {
      return;
    }
    void (async () => {
      const draft = await loadVaultDraft(userId, spaceId);
      if (!draft) {
        return;
      }
      reset(draft);
      if (draft.audio) {
        setAudio(draft.audio);
        const ciphertext = await loadVaultDraftAudio(
          userId,
          spaceId,
          draftId,
          draft.audio.id,
        );
        if (ciphertext) {
          setAudioCiphertext(ciphertext);
        }
      }
    })();
  }, [userId, spaceId, entryIdParam, isRootDraft, reset, draftId]);

  useEffect(() => {
    if (!userId || !spaceId) {
      return;
    }
    void (async () => {
      try {
        const rows = await fetchVaultEntries(spaceId);
        if (parentId) {
          const parent = rows.find((row) => row.id === parentId);
          if (parent) {
            setVisibility(parent.visibility);
          }
        }
        if (!entryIdParam) {
          return;
        }
        const row = rows.find((item) => item.id === entryIdParam);
        if (!row) {
          setFormError(copy.common.error);
          return;
        }
        const familyKey = await loadFamilyKeyForVault(userId, spaceId);
        let personalKey: Uint8Array | null = null;
        try {
          personalKey = await loadPersonalKeyIfPresent({ spaceId, userId });
        } catch (error) {
          if (error instanceof Error && error.message === personalKeyNeedsOtherPhone) {
            setFormError(copy.vault.approveOtherPhone);
            return;
          }
          throw error;
        }
        const content = openVaultEntryContent(row, { familyKey, personalKey });
        if (familyKey) {
          wipe(familyKey);
        }
        if (personalKey) {
          wipe(personalKey);
        }
        if (!content) {
          setFormError(copy.vault.openFailed);
          return;
        }
        reset(content);
        setExisting(row);
        setVisibility(row.visibility);
        setAudio(content.audio);
        setPreviousAudioId(content.audio?.id ?? null);
        const openedChildren: { row: VaultEntryRow; content: VaultDecisionContent }[] = [];
        const childFamily = await loadFamilyKeyForVault(userId, spaceId);
        let childPersonal: Uint8Array | null = null;
        try {
          childPersonal = await loadPersonalKeyIfPresent({ spaceId, userId });
        } catch {
          childPersonal = null;
        }
        for (const child of rows.filter((item) => item.parentEntryId === row.id)) {
          const childContent = openVaultEntryContent(child, {
            familyKey: childFamily,
            personalKey: childPersonal,
          });
          if (childContent) {
            openedChildren.push({ row: child, content: childContent });
          }
        }
        if (childFamily) {
          wipe(childFamily);
        }
        if (childPersonal) {
          wipe(childPersonal);
        }
        setChildren(openedChildren);
      } catch (error) {
        logFailedAction(error);
        setFormError(copy.vault.openFailed);
      } finally {
        setReady(true);
      }
    })();
  }, [userId, spaceId, entryIdParam, parentId, reset]);

  const persistDraft = (nextAudio?: VaultDecisionContent['audio'] | null) => {
    if (!userId || !spaceId || !isRootDraft) {
      return;
    }
    const values = getValues();
    const next = nextAudio === undefined ? audio : (nextAudio ?? undefined);
    if (!values.title && !values.body && !values.for && !next) {
      return;
    }
    void saveVaultDraft(userId, spaceId, {
      title: values.title,
      body: values.body,
      for: values.for,
      audio: next,
    });
  };

  const onRecorded = (draft: VoiceDraft) => {
    if (!spaceId) {
      wipe(draft.plain);
      return;
    }
    try {
      const prepared = prepareVaultAudio({
        spaceId,
        entryId: draftId,
        durationSeconds: draft.durationSeconds,
        plain: draft.plain,
      });
      setAudio(prepared.ref);
      setAudioCiphertext(prepared.ciphertext);
      persistDraft(prepared.ref);
      if (userId && isRootDraft) {
        void saveVaultDraftAudio(userId, spaceId, draftId, prepared.ref.id, prepared.ciphertext);
      }
    } finally {
      wipe(draft.plain);
    }
  };

  const onRemoveVoice = () => {
    setAudio(undefined);
    setAudioCiphertext(null);
    persistDraft(null);
  };

  const onSave = async () => {
    Keyboard.dismiss();
    const parsed = schema.safeParse(getValues());
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      if (first?.path[0] === 'title') {
        setFieldError('title', { type: 'manual' });
      }
      if (first?.path[0] === 'body') {
        setFieldError('body', { type: 'manual' });
      }
      setFormError(copy.vault.saveFailed);
      return;
    }
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
      setSaving(true);
      const familyKey = await loadFamilyKeyForVault(userId, spaceId);
      const nextVisibility = visibilityRef.current;
      if (!familyKey && nextVisibility === 'family') {
        setFormError(copy.vault.noKey);
        return;
      }
      const content: VaultDecisionContent = {
        title: parsed.data.title,
        body: parsed.data.body,
        for: parsed.data.for,
        audio: audioRef.current,
      };
      await persistVaultDecision({
        userId,
        spaceId,
        entryId: existingRef.current?.id ?? draftId,
        parentEntryId: parentId ?? null,
        existing: existingRef.current,
        children: childrenRef.current,
        visibility: nextVisibility,
        content,
        familyKey,
        keyEpoch: epoch,
        audioCiphertext: audioCiphertextRef.current,
        previousAudioId,
      });
      if (familyKey) {
        wipe(familyKey);
      }
      if (isRootDraft) {
        await clearVaultDraft(userId, spaceId);
      }
      void queryClient.invalidateQueries({ queryKey: ['vaultEntries', spaceId] });
      if (parentId) {
        router.replace(routes.vaultEntry(parentId));
        return;
      }
      if (entryIdParam) {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace(routes.vaultEntry(entryIdParam));
        }
        return;
      }
      router.replace(routes.vault);
    } catch (error) {
      logFailedAction(error);
      if (error instanceof Error && error.message === personalKeyNeedsOtherPhone) {
        setFormError(copy.vault.approveOtherPhone);
        return;
      }
      const message =
        error instanceof Error && error.message === 'too large'
          ? copy.vault.tooLarge
          : copy.vault.saveFailed;
      const detail =
        process.env.EXPO_PUBLIC_E2E === '1' && error instanceof Error
          ? ` ${error.message.slice(0, 80)}`
          : '';
      setFormError(`${message}${detail}`);
    } finally {
      setSaving(false);
    }
  };

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
      {formError ? (
        <>
          <ErrorState message={formError} />
          <Button
            label={copy.common.tryAgain}
            variant="secondary"
            onPress={() => void onSave()}
            busy={saving}
          />
        </>
      ) : null}
      <Caption>
        {visibility === 'private' ? copy.vault.onlyMeHint : copy.vault.lockNote}
      </Caption>
      {canChangeVisibility ? (
        <>
          <Caption>{copy.vault.whoCanRead}</Caption>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <ChoiceChip
              label={copy.vault.family}
              selected={visibility === 'family'}
              onPress={() => {
                if (visibility === 'family') {
                  return;
                }
                if (existing) {
                  confirmVisibilityChange('family', () => setVisibility('family'));
                  return;
                }
                setVisibility('family');
              }}
            />
            <ChoiceChip
              label={copy.vault.onlyMe}
              selected={visibility === 'private'}
              onPress={() => {
                if (visibility === 'private') {
                  return;
                }
                if (existing) {
                  confirmVisibilityChange('private', () => setVisibility('private'));
                  return;
                }
                setVisibility('private');
              }}
            />
          </View>
          <Caption>
            {visibility === 'private' ? copy.vault.onlyMeHint : copy.vault.familyHint}
          </Caption>
        </>
      ) : (
        <Caption>
          {visibility === 'private' ? copy.vault.onlyMeHint : copy.vault.familyHint}
        </Caption>
      )}
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
            returnKeyType="default"
            blurOnSubmit={false}
            error={fieldState.error ? copy.vault.bodyLabel : undefined}
          />
        )}
      />
      <VoiceNoteField
        durationSeconds={audio?.durationSeconds ?? null}
        onRecorded={onRecorded}
        onRemove={onRemoveVoice}
      />
      <Button
        label={copy.vault.save}
        onPress={() => void onSave()}
        busy={saving}
      />
      {isRootDraft ? (
        <Button label={copy.vault.discard} variant="ghost" onPress={() => void onDiscard()} />
      ) : null}
      <View style={{ height: 80 }} />
    </Screen>
  );
}

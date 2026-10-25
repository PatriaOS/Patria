import { Sparkles } from 'lucide-react-native';
import { StyleSheet, TextInput, View } from 'react-native';

import { copy } from '../../lib/copy';
import {
  Avatar,
  Body,
  Button,
  Caption,
  ChoiceChip,
  Display,
  ErrorState,
  Icon,
  Overline,
  Pressable,
  Small,
} from '../../ui';
import { fontFamilies, radius, space, typeScale } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { kindLabel } from './syncLabels';
import { SYNC_AGENDA_KINDS, type SyncAgendaKind } from './syncSchedule';

export type AddedByOption = { id: string; label: string };

export type AddAgendaFormProps = {
  kind: SyncAgendaKind;
  title: string;
  details: string;
  titleError: boolean;
  addedById: string | null;
  addedByOptions: AddedByOption[];
  selfLabel: string;
  selfId: string;
  showAddedBy: boolean;
  editing: boolean;
  busy: boolean;
  error: string | null;
  meetingSubtitle: string;
  onKind: (kind: SyncAgendaKind) => void;
  onTitle: (value: string) => void;
  onDetails: (value: string) => void;
  onAddedBy: (id: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
};

export function AddAgendaForm(props: AddAgendaFormProps) {
  const { colors, fontFamily, previewScale, maxFontSizeMultiplier } = useTheme();
  const hint = copy.sync.kindHintCards[props.kind];
  const peerIds = [props.selfId, ...props.addedByOptions.map((option) => option.id)];

  return (
    <>
      <View style={styles.topBar}>
        <View style={styles.topBarSpacer} />
        <Pressable
          testID="cancel"
          accessibilityRole="button"
          accessibilityLabel={copy.common.cancel}
          onPress={props.onCancel}
        >
          <Caption color={colors.accentTerracotta}>{copy.common.cancel}</Caption>
        </Pressable>
      </View>
      <Display>{props.editing ? copy.sync.editAgendaTitle : copy.sync.addToAgenda}</Display>
      <Small tone="muted">{props.meetingSubtitle}</Small>
      {props.error ? <ErrorState message={props.error} /> : null}

      <Overline>{copy.sync.kindOverline}</Overline>
      <View style={styles.chips}>
        {SYNC_AGENDA_KINDS.map((kind) => (
          <ChoiceChip
            key={kind}
            label={kindLabel(kind)}
            selected={props.kind === kind}
            onPress={() => props.onKind(kind)}
          />
        ))}
      </View>

      <View style={[styles.hintCard, { backgroundColor: colors.sageSoft }]}>
        <Icon icon={Sparkles} name="sparkles" color={colors.primary} size={20} decorative />
        <View style={styles.hintCopy}>
          <Body style={{ fontFamily: fontFamily('bodyBold') }}>{hint.lead}</Body>
          <Caption tone="muted">{hint.body}</Caption>
        </View>
      </View>

      <Overline>{copy.sync.itemTitleLabel}</Overline>
      <TextInput
        testID="title"
        accessibilityLabel={copy.sync.itemTitleLabel}
        placeholder={copy.sync.itemTitlePlaceholder}
        placeholderTextColor={colors.textMuted}
        value={props.title}
        onChangeText={props.onTitle}
        allowFontScaling
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[
          styles.titleInput,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: props.titleError ? colors.danger : colors.hairline,
            fontFamily: fontFamily('display') ?? fontFamilies.display,
            fontSize: typeScale.title.size * previewScale,
          },
        ]}
      />
      {props.titleError ? <Caption color={colors.danger}>{copy.sync.itemTitleError}</Caption> : null}

      <Overline>{copy.sync.detailsLabel}</Overline>
      <TextInput
        testID="details"
        accessibilityLabel={copy.sync.detailsLabel}
        placeholder={copy.sync.detailsPlaceholder}
        placeholderTextColor={colors.textMuted}
        value={props.details}
        onChangeText={props.onDetails}
        multiline
        allowFontScaling
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={[
          styles.detailsInput,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: colors.hairline,
            fontFamily: fontFamily('body'),
            fontSize: typeScale.body.size * previewScale,
          },
        ]}
      />

      {props.showAddedBy ? (
        <>
          <Overline>{copy.sync.addedByLabel}</Overline>
          <View style={styles.chips}>
            <Pressable
              testID="added-by-me"
              accessibilityRole="button"
              accessibilityLabel={props.selfLabel}
              accessibilityState={{ selected: props.addedById === null }}
              onPress={() => props.onAddedBy(null)}
              style={[
                styles.personChip,
                {
                  backgroundColor: props.addedById === null ? colors.primary : colors.surface,
                  borderColor: props.addedById === null ? colors.primary : colors.hairline,
                },
              ]}
            >
              <Avatar id={props.selfId} name={props.selfLabel} peerIds={peerIds} size={24} decorative />
              <Caption color={props.addedById === null ? colors.onPrimary : colors.text}>
                {props.selfLabel}
              </Caption>
            </Pressable>
            {props.addedByOptions.map((option) => {
              const selected = props.addedById === option.id;
              return (
                <Pressable
                  key={option.id}
                  testID={`added-by-${option.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  onPress={() => props.onAddedBy(option.id)}
                  style={[
                    styles.personChip,
                    {
                      backgroundColor: selected ? colors.primary : colors.surface,
                      borderColor: selected ? colors.primary : colors.hairline,
                    },
                  ]}
                >
                  <Avatar id={option.id} name={option.label} peerIds={peerIds} size={24} decorative />
                  <Caption color={selected ? colors.onPrimary : colors.text}>{option.label}</Caption>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Button
        label={props.editing ? copy.sync.save : copy.sync.addToAgendaAction}
        onPress={props.onSave}
        busy={props.busy}
        testID={props.editing ? 'save' : 'add-to-agenda'}
      />
      {props.editing && props.onDelete ? (
        <Button label={copy.sync.delete} variant="danger" onPress={props.onDelete} disabled={props.busy} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 44,
    alignItems: 'center',
  },
  topBarSpacer: { flex: 1 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  hintCard: {
    flexDirection: 'row',
    gap: space.sm,
    borderRadius: radius.card,
    padding: space.md,
    alignItems: 'flex-start',
  },
  hintCopy: {
    flex: 1,
    gap: 2,
  },
  titleInput: {
    minHeight: 52,
    borderRadius: radius.tile,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  detailsInput: {
    minHeight: 96,
    borderRadius: radius.tile,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    textAlignVertical: 'top',
  },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.button,
    borderWidth: 1,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    minHeight: 44,
  },
});

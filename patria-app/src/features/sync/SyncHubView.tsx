import { Check, Plus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import {
  Banner,
  Body,
  Button,
  ButtonStack,
  Caption,
  Card,
  Display,
  EmptyState,
  ErrorState,
  Icon,
  Overline,
  Pressable,
  Section,
} from '../../ui';
import { radius, space, stroke } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { fillTemplate } from './syncLabels';
import { SYNC_STEPS, type SyncAgendaKind, type SyncStep } from './syncSchedule';

export type SyncAgendaRowView = {
  id: string;
  title: string;
  body: string;
  kind: SyncAgendaKind;
  kindLabel: string;
  editable: boolean;
};

export type SyncHubViewProps = {
  admin: boolean;
  hasSchedule: boolean;
  hasMeeting: boolean;
  circleName: string;
  whenLabel: string;
  countdown: string | null;
  canContinue: boolean;
  missed: boolean;
  runnerName: string | null;
  /** 0-based current step while a meeting runs; null = all upcoming. */
  flowStepIndex: number | null;
  agenda: SyncAgendaRowView[];
  busy: boolean;
  error: string | null;
  canReply?: boolean;
  myAnswer?: 'going' | 'cant' | null;
  goingNames?: string[];
  cantNames?: string[];
  unansweredNames?: string[];
  calendarNotice?: string | null;
  onSetUp: () => void;
  onContinue: () => void;
  onHoldNow: () => void;
  onNextDate: () => void;
  onFollow: () => void;
  onAddAgenda: () => void;
  onSchedule: () => void;
  onMoveMeeting?: () => void;
  onPast: () => void;
  onTasks: () => void;
  onOpenItem: (id: string) => void;
  onAnswerGoing?: () => void;
  onAnswerCant?: () => void;
  onAddToCalendar?: () => void;
};

function stepState(
  index: number,
  flowStepIndex: number | null,
): 'upcoming' | 'current' | 'done' {
  if (flowStepIndex == null) {
    return 'upcoming';
  }
  if (index < flowStepIndex) {
    return 'done';
  }
  if (index === flowStepIndex) {
    return 'current';
  }
  return 'upcoming';
}

function FlowProgress({ flowStepIndex }: { flowStepIndex: number | null }) {
  const { colors } = useTheme();
  return (
    <Card testID="sync-tonight-flow">
      <View style={styles.flowHeader}>
        <Section>{copy.sync.tonightFlow}</Section>
        <Caption tone="muted">{copy.sync.flowTotal}</Caption>
      </View>
      <View style={styles.flowRow}>
        {SYNC_STEPS.map((step, index) => {
          const info = copy.sync.steps[step as SyncStep];
          const state = stepState(index, flowStepIndex);
          const fill =
            state === 'done'
              ? colors.primary
              : state === 'current'
                ? colors.accentMustard
                : colors.softSurface;
          const labelColor =
            state === 'done'
              ? colors.onPrimary
              : state === 'current'
                ? colors.onMustard
                : colors.textMuted;
          return (
            <View key={step} style={styles.flowStep} testID={`sync-flow-step-${step}`}>
              <View
                style={[styles.flowCircle, { backgroundColor: fill }]}
                accessible
                accessibilityLabel={`${index + 1}${state === 'done' ? ', done' : state === 'current' ? ', current' : ''}`}
              >
                {state === 'done' ? (
                  <Icon icon={Check} name="check" color={labelColor} size={16} decorative />
                ) : (
                  <Caption color={labelColor} accessible={false}>
                    {String(index + 1)}
                  </Caption>
                )}
              </View>
              <Caption
                color={state === 'upcoming' ? colors.textMuted : colors.text}
                style={styles.flowLabel}
                numberOfLines={2}
                accessibilityLabel={info.title}
              >
                {info.title}
              </Caption>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function kindColors(
  kind: SyncAgendaKind,
  colors: ReturnType<typeof useTheme>['colors'],
): { bg: string; text: string; rowBg?: string } {
  if (kind === 'win') {
    return { bg: colors.kindWinBg, text: colors.kindWinText, rowBg: colors.kindWinBg };
  }
  if (kind === 'discuss') {
    return { bg: colors.kindDiscussBg, text: colors.kindDiscussText };
  }
  if (kind === 'decide') {
    return { bg: colors.kindDecideBg, text: colors.kindDecideText };
  }
  return { bg: colors.kindPlanBg, text: colors.kindPlanText };
}

function AgendaCard(props: {
  agenda: SyncAgendaRowView[];
  onOpenItem: (id: string) => void;
  onAddAgenda: () => void;
  canAdd: boolean;
}) {
  const { colors } = useTheme();
  const countLabel =
    props.agenda.length === 1
      ? copy.sync.agendaCountOne
      : fillTemplate(copy.sync.agendaCount, { count: String(props.agenda.length) });

  return (
    <>
      <View style={styles.agendaHeader}>
        <Section>{copy.sync.agenda}</Section>
        <View style={styles.agendaHeaderRight}>
          <Caption tone="muted">{countLabel}</Caption>
          {props.canAdd ? (
            <Pressable
              testID="add-to-agenda-icon"
              accessibilityRole="button"
              accessibilityLabel={copy.sync.addToAgenda}
              onPress={props.onAddAgenda}
              style={[styles.addRound, { backgroundColor: colors.primary }]}
            >
              <Icon icon={Plus} name="plus" color={colors.onPrimary} size={18} decorative />
            </Pressable>
          ) : null}
        </View>
      </View>
      {props.agenda.length === 0 ? (
        <EmptyState title={copy.sync.emptyAgenda} message={copy.sync.emptyAgendaBody} compact />
      ) : (
        <Card testID="sync-agenda-card">
          {props.agenda.map((item, index) => {
            const tone = kindColors(item.kind, colors);
            return (
              <View
                key={item.id}
                testID={`agenda-item-${item.id}`}
                style={[
                  styles.agendaRow,
                  index > 0 ? { borderTopWidth: stroke.hairline, borderTopColor: colors.hairline } : null,
                  tone.rowBg ? { backgroundColor: tone.rowBg, marginHorizontal: -space.card, paddingHorizontal: space.card } : null,
                ]}
              >
                <View style={styles.agendaCopy}>
                  <Pressable
                    accessibilityRole={item.editable ? 'button' : undefined}
                    accessibilityLabel={item.title}
                    onPress={item.editable ? () => props.onOpenItem(item.id) : undefined}
                  >
                    <Body accessible={false}>{item.title}</Body>
                  </Pressable>
                  {item.body ? (
                    <Caption tone="muted" accessible accessibilityLabel={item.body}>
                      {item.body}
                    </Caption>
                  ) : null}
                </View>
                <View
                  style={[styles.kindPill, { backgroundColor: tone.bg }]}
                  accessible
                  accessibilityLabel={item.kindLabel}
                >
                  <Caption color={tone.text} accessible={false}>
                    {item.kindLabel}
                  </Caption>
                </View>
              </View>
            );
          })}
        </Card>
      )}
      <Button
        label={copy.sync.addToAgenda}
        variant="secondary"
        onPress={props.onAddAgenda}
        disabled={!props.canAdd}
      />
    </>
  );
}

export function SyncHubView(props: SyncHubViewProps) {
  const { colors } = useTheme();
  const overline = `${props.circleName} · ${props.whenLabel}`.toUpperCase();

  if (!props.hasSchedule) {
    return (
      <>
        <Display>{copy.sync.title}</Display>
        <EmptyState
          title={copy.sync.lead}
          message={props.admin ? copy.sync.setUpBody : copy.sync.askAdminSetup}
          action={
            props.admin ? (
              <Button label={copy.sync.setUpOurSync} onPress={props.onSetUp} />
            ) : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          {props.hasMeeting ? (
            <Overline tone="terracotta">{overline}</Overline>
          ) : null}
          <Display>{copy.sync.title}</Display>
        </View>
        {props.admin && props.hasMeeting && props.canContinue && !props.runnerName && !props.missed ? (
          <Pressable
            testID="continue"
            accessibilityRole="button"
            accessibilityLabel={copy.sync.continue}
            onPress={props.onContinue}
            style={[styles.continueChip, { backgroundColor: colors.accentTerracotta }]}
          >
            <Caption color={colors.onPrimary}>{copy.sync.continue}</Caption>
          </Pressable>
        ) : null}
      </View>

      {props.runnerName ? (
        <>
          <Banner message={fillTemplate(copy.sync.runningOn, { name: props.runnerName })} />
          <Button label={copy.sync.viewReadOnly} variant="secondary" onPress={props.onFollow} />
        </>
      ) : null}

      {!props.runnerName && props.missed ? (
        <>
          <Body
            tone="muted"
            testID="sync-missed"
            accessibilityLabel={copy.sync.missedNoGuilt}
          >
            {copy.sync.missedNoGuilt}
          </Body>
          {props.admin ? (
            <ButtonStack>
              <Button
                label={copy.sync.holdItNow}
                variant="accent"
                busy={props.busy}
                onPress={props.onHoldNow}
              />
              <Button
                label={copy.sync.nextDate}
                variant="secondary"
                disabled={props.busy}
                onPress={props.onNextDate}
              />
            </ButtonStack>
          ) : null}
        </>
      ) : null}

      {!props.hasMeeting ? (
        <Body tone="muted">{props.admin ? copy.common.loading : copy.sync.noMeetingYet}</Body>
      ) : null}

      {props.error ? <ErrorState message={props.error} /> : null}

      {props.hasMeeting && props.canReply ? (
        <Card testID="sync-rsvp">
          <Section>{copy.sync.rsvpYourReply}</Section>
          <ButtonStack>
            <Button
              label={copy.sync.rsvpGoing}
              testID="rsvp-going"
              variant={props.myAnswer === 'going' ? 'primary' : 'secondary'}
              busy={props.busy}
              onPress={props.onAnswerGoing ?? (() => undefined)}
            />
            <Button
              label={copy.sync.rsvpCant}
              testID="rsvp-cant"
              variant={props.myAnswer === 'cant' ? 'primary' : 'secondary'}
              busy={props.busy}
              onPress={props.onAnswerCant ?? (() => undefined)}
            />
          </ButtonStack>
          <Button
            label={copy.sync.addToCalendar}
            testID="add-to-calendar"
            variant="ghost"
            disabled={props.busy}
            onPress={props.onAddToCalendar ?? (() => undefined)}
          />
          {props.calendarNotice ? <Caption tone="muted">{props.calendarNotice}</Caption> : null}
        </Card>
      ) : null}

      {props.hasMeeting && !props.missed && !props.runnerName ? (
        <Card testID="sync-whos-coming">
          <Section>{copy.sync.whosComing}</Section>
          <Caption tone="muted">
            {fillTemplate(copy.sync.rsvpGoingCount, {
              count: String(props.goingNames?.length ?? 0),
            })}
          </Caption>
          {(props.goingNames ?? []).length > 0 ? (
            <Body>{(props.goingNames ?? []).join(', ')}</Body>
          ) : null}
          <Caption tone="muted">
            {fillTemplate(copy.sync.rsvpCantCount, {
              count: String(props.cantNames?.length ?? 0),
            })}
          </Caption>
          {(props.cantNames ?? []).length > 0 ? (
            <Body>{(props.cantNames ?? []).join(', ')}</Body>
          ) : null}
          {props.admin && (props.unansweredNames?.length ?? 0) > 0 ? (
            <>
              <Caption tone="muted">{copy.sync.rsvpUnanswered}</Caption>
              <Body>{(props.unansweredNames ?? []).join(', ')}</Body>
            </>
          ) : null}
        </Card>
      ) : null}

      {props.hasMeeting ? <FlowProgress flowStepIndex={props.flowStepIndex} /> : null}

      {props.hasMeeting ? (
        <AgendaCard
          agenda={props.agenda}
          onOpenItem={props.onOpenItem}
          onAddAgenda={props.onAddAgenda}
          canAdd={Boolean(props.hasMeeting)}
        />
      ) : null}

      {props.admin ? (
        <ButtonStack>
          {props.hasMeeting && props.onMoveMeeting ? (
            <Button
              label={copy.sync.moveThisMeeting}
              testID="move-this-meeting"
              variant="ghost"
              onPress={props.onMoveMeeting}
            />
          ) : null}
          <Button
            label={copy.sync.changeSchedule}
            testID="schedule"
            variant="ghost"
            onPress={props.onSchedule}
          />
        </ButtonStack>
      ) : null}
      <Button label={copy.sync.tasks} variant="ghost" onPress={props.onTasks} />
      <Button label={copy.sync.pastMeetings} variant="ghost" onPress={props.onPast} />
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  headerCopy: {
    flex: 1,
    gap: space.xxs,
  },
  continueChip: {
    borderRadius: radius.button,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    minHeight: 36,
    justifyContent: 'center',
  },
  flowHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  flowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  flowStep: {
    flex: 1,
    alignItems: 'center',
    gap: space.xxs,
  },
  flowCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowLabel: {
    textAlign: 'center',
  },
  agendaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  agendaHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  addRound: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    minHeight: 52,
  },
  agendaCopy: {
    flex: 1,
    gap: 2,
  },
  kindPill: {
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: space.xxs,
  },
});

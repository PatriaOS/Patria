import { Check } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { Body, Button, Caption, Card, ErrorState, Icon, Muted, Pressable, Section } from '../../ui';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { SyncTaskRow } from '../sync/syncApi';
import { canToggleTask, taskPeopleLine, type PersonLookup } from '../sync/syncLabels';
import { selectThisWeekTasks, taskDoneLabel, taskDueChip } from '../sync/syncHome';

type Props = {
  tasks: SyncTaskRow[];
  people: PersonLookup;
  userId: string | undefined;
  admin: boolean;
  timeZone: string;
  loading: boolean;
  failed: boolean;
  toggleError: string | null;
  now?: Date;
  canAdd?: boolean;
  onToggle: (task: SyncTaskRow) => void;
  onSeeAll: () => void;
  onAdd?: () => void;
};

function TaskRow({
  task,
  people,
  canToggle,
  timeZone,
  now,
  onToggle,
}: {
  task: SyncTaskRow;
  people: PersonLookup;
  canToggle: boolean;
  timeZone: string;
  now: Date;
  onToggle: () => void;
}) {
  const { colors, scheme } = useTheme();
  const done = Boolean(task.doneAt);
  const who = taskPeopleLine(task, people);
  const chip = done ? taskDoneLabel(task, timeZone, now) : taskDueChip(task.dueOn, timeZone, now);
  const state = done ? copy.home.taskStateDone : copy.home.taskStateOpen;
  const label = [copy.home.taskCheckLabel.replace('{title}', task.title).replace('{state}', state), who, chip]
    .filter(Boolean)
    .join('. ');
  // Light: forest fill + white tick. Dark: soft sage fill + dark tick (Figma).
  const doneFill = scheme === 'dark' ? '#C9D8CC' : colors.primary;
  const tickColor = scheme === 'dark' ? colors.text : colors.onPrimary;

  return (
    <Pressable
      testID={`home-task-${task.id}`}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: done, disabled: !canToggle }}
      disabled={!canToggle}
      onPress={onToggle}
      style={styles.row}
    >
      <View style={styles.checkHit}>
        <View
          style={[
            styles.circle,
            {
              borderColor: done ? doneFill : colors.textMuted,
              backgroundColor: done ? doneFill : 'transparent',
            },
          ]}
        >
          {done ? <Icon icon={Check} name="check" color={tickColor} size={14} decorative /> : null}
        </View>
      </View>
      <View style={styles.copy}>
        <Body tone={done ? 'muted' : 'default'}>{task.title}</Body>
        {who ? <Caption tone="muted">{who}</Caption> : null}
      </View>
      {chip ? (
        <View
          style={[
            styles.chip,
            { backgroundColor: done ? colors.primary : colors.softSurface },
          ]}
        >
          <Caption color={done ? colors.onPrimary : colors.text}>{chip}</Caption>
        </View>
      ) : null}
    </Pressable>
  );
}

/** "This week" on Home: up to four Sync tasks due this week (not agenda items). */
export function ThisWeekTasks(props: Props) {
  const { colors } = useTheme();
  const now = props.now ?? new Date();
  const shown = selectThisWeekTasks(props.tasks, props.timeZone, now);

  return (
    <View style={styles.section} testID="home-this-week">
      <View style={styles.header}>
        <Section>{copy.home.thisWeek}</Section>
        <Pressable
          testID="home-this-week-see-all"
          accessibilityRole="link"
          accessibilityLabel={copy.home.thisWeekSeeAll}
          onPress={props.onSeeAll}
          style={styles.seeAll}
        >
          <Body color={colors.accentTerracotta}>{copy.home.seeAll}</Body>
        </Pressable>
      </View>
      {props.failed ? <ErrorState message={copy.home.thisWeekFailed} /> : null}
      {props.toggleError ? <ErrorState message={props.toggleError} /> : null}
      {!props.failed && props.loading ? <Muted>{copy.common.loading}</Muted> : null}
      {!props.failed && !props.loading && shown.length === 0 ? (
        <Card tone="surface" testID="home-this-week-empty">
          <Muted>{copy.home.thisWeekEmpty}</Muted>
          <Body>{copy.home.thisWeekEmptyBody}</Body>
          {props.canAdd && props.onAdd ? (
            <Button
              label={copy.home.thisWeekAdd}
              testID="home-this-week-add"
              onPress={props.onAdd}
            />
          ) : (
            <Muted>{copy.home.thisWeekAskAdmin}</Muted>
          )}
        </Card>
      ) : null}
      {!props.failed && !props.loading && shown.length > 0 ? (
        <Card tone="surface">
          {shown.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              people={props.people}
              timeZone={props.timeZone}
              now={now}
              canToggle={canToggleTask(task, props.userId, props.admin)}
              onToggle={() => props.onToggle(task)}
            />
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  seeAll: {
    minHeight: 44,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingVertical: space.xs,
  },
  checkHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: space.xxs,
  },
});

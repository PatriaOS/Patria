import { useState } from 'react';
import { View } from 'react-native';

import { copy } from '../../lib/copy';
import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  Section,
} from '../../ui';
import {
  circleDisplayName,
  formatMeetingDay,
  readMeetingSummary,
  summaryLine,
} from './syncLabels';
import { useSyncSpace } from './useSyncSpace';

export function PastMeetingsScreen() {
  const sync = useSyncSpace();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const screenProps = {
    withHeader: true,
    testID: 'screen-sync-past',
    accessibilityLabel: copy.sync.pastMeetings,
  } as const;

  if (sync.loading) {
    return (
      <Screen {...screenProps}>
        <LoadingState message={copy.common.loading} />
      </Screen>
    );
  }
  if (sync.failed) {
    return (
      <Screen {...screenProps}>
        <ErrorState message={copy.common.error} />
        <Button label={copy.common.tryAgain} variant="secondary" onPress={sync.refresh} />
      </Screen>
    );
  }

  const zone = sync.schedule?.timezone ?? 'UTC';
  const finished = sync.meetings
    .filter((meeting) => meeting.status === 'finished')
    .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));

  return (
    <Screen
      {...screenProps}
      refreshing={pullRefreshing}
      onRefresh={() => {
        setPullRefreshing(true);
        sync.refresh();
        requestAnimationFrame(() => setPullRefreshing(false));
      }}
    >
      {finished.length === 0 ? (
        <EmptyState title={copy.sync.pastMeetings} message={copy.sync.noPastMeetings} />
      ) : (
        finished.map((meeting) => {
          const summary = readMeetingSummary(meeting.summary);
          const circle = sync.circlesQuery.data?.find((row) => row.id === meeting.circleId);
          return (
            <Card key={meeting.id} variant="soft">
              <Section>{formatMeetingDay(meeting.scheduledFor, zone)}</Section>
              <Caption tone="muted">{circleDisplayName(circle)}</Caption>
              <Body>{meeting.priorityText.trim() || copy.sync.noPriority}</Body>
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}
                testID={`past-meeting-summary-${meeting.id}`}
              >
                <Caption tone="muted">{copy.sync.summary}</Caption>
                <Caption tone="muted">{summaryLine(summary)}</Caption>
              </View>
              {summary.decisions.map((entry) => (
                <ListRow key={`${entry.title}:${entry.decision}`} title={entry.title} body={entry.decision} />
              ))}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

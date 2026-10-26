import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { homeDateOverline, homeFamilyLine, homeGreeting } from '../family/homeGreeting';
import { HomeSyncCard } from '../family/HomeSyncCard';
import { OnThisDayCard } from '../family/OnThisDayCard';
import { SecurityStatusCard } from '../family/SecurityStatusCard';
import { ThisWeekTasks } from '../family/ThisWeekTasks';
import type { MemoryItem } from '../memories/memoryApi';
import type { SyncTaskRow } from '../sync/syncApi';
import { homeSyncOverline } from '../sync/syncHome';
import { nextMeetingAt } from '../sync/syncSchedule';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme';
import {
  AvatarStack,
  Button,
  Card,
  Display,
  DisplayItalic,
  Muted,
  Overline,
  Pressable,
  Screen,
  TabBar,
  Title,
} from '../../ui';
import { parsePreviewScale, parsePreviewScheme } from './DesignGalleryScreen';

const noop = () => undefined;

const PREVIEW_THUMB = require('../../../assets/e2e/sample1.jpg') as number;

const previewPeople = [
  { id: 'u-elena', name: 'Elena Rivera' },
  { id: 'u-marco', name: 'Marco Rivera' },
  { id: 'u-rosa', name: 'Rosa Rivera' },
  { id: 'c-sofia', name: 'Sofia' },
  { id: 'c-mateo', name: 'Mateo' },
];

const peopleLookup = {
  members: [
    { userId: 'u-elena', displayName: 'Elena Rivera' },
    { userId: 'u-marco', displayName: 'Marco Rivera' },
    { userId: 'u-rosa', displayName: 'Rosa Rivera' },
  ],
  children: [
    { id: 'c-sofia', displayName: 'Sofia' },
    { id: 'c-mateo', displayName: 'Mateo' },
  ],
};

const previewMemory: MemoryItem = {
  id: 'm-otd',
  familySpaceId: 'space',
  circleId: 'circ-household',
  circleName: 'Household',
  circleKind: 'household',
  uploaderId: 'u-elena',
  uploaderName: 'Elena Rivera',
  caption: 'First day at the cottage',
  takenAt: '2021-10-25T18:00:00.000Z',
  createdAt: '2021-10-25T18:00:00.000Z',
  width: 1200,
  height: 900,
  fullPath: 'full/m-otd.jpg',
  thumbPath: 'thumb/m-otd.jpg',
  thumbUrl: null,
  fullUrl: null,
  kind: 'photo',
  durationSeconds: null,
  addedAutomatically: false,
  sourceHash: null,
};

function task(partial: Partial<SyncTaskRow> & Pick<SyncTaskRow, 'id' | 'title'>): SyncTaskRow {
  return {
    familySpaceId: 'space',
    meetingId: 'meet-1',
    ownerUserId: null,
    ownerChildId: null,
    backupUserId: null,
    backupChildId: null,
    dueOn: null,
    doneAt: null,
    doneBy: null,
    ...partial,
  };
}

const previewTasks: SyncTaskRow[] = [
  task({
    id: 't1',
    title: 'Book the dentist for Sofia',
    dueOn: '2026-10-27',
    ownerUserId: 'u-elena',
    backupUserId: 'u-marco',
  }),
  task({
    id: 't2',
    title: 'Renew the passports',
    dueOn: '2026-10-28',
    ownerUserId: 'u-marco',
  }),
  task({
    id: 't3',
    title: 'Pack for the picnic',
    dueOn: '2026-10-30',
    ownerChildId: 'c-sofia',
    backupUserId: 'u-elena',
  }),
  task({
    id: 't4',
    title: 'Order new soccer boots',
    dueOn: '2026-10-26',
    ownerUserId: 'u-elena',
    doneAt: '2026-10-25T14:00:00.000Z',
    doneBy: 'u-elena',
  }),
];

export function DesignHomeScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <PreviewBody />;
}

function PreviewBody() {
  const { colors, setPreviewScale, setPreviewScheme } = useTheme();
  const params = useLocalSearchParams<{ appearance?: string; scale?: string; notice?: string }>();
  const showNotice = params.notice === '1' || params.notice === 'true';

  useEffect(() => {
    const nextScheme = parsePreviewScheme(params.appearance);
    if (nextScheme) {
      setPreviewScheme(nextScheme);
    }
    const nextScale = parsePreviewScale(params.scale);
    if (nextScale) {
      setPreviewScale(nextScale);
    }
  }, [params.appearance, params.scale, setPreviewScale, setPreviewScheme]);

  // Preview uses the real clock + a Sunday schedule so the overline matches production.
  const now = new Date();
  const schedule = { weekday: 0, localTime: '19:00', timezone: 'America/Chicago' };
  const next = nextMeetingAt(schedule, now);
  const overline = homeSyncOverline({ scheduledFor: next, status: 'upcoming' }, schedule.timezone, now);

  return (
    <View style={[styles.shell, { backgroundColor: colors.background }]} testID="design-home">
      <Screen withTabBar testID="home" accessibilityLabel={copy.tabs.home}>
        {showNotice ? (
          <>
            <SecurityStatusCard
              attentionOnly
              keyStatus="waitingOwnPhone"
              recoveryStatus="needs_attention"
              keyHolder
              admin
              familyName="Rivera"
              keysTestID="home-keys-status"
              recoveryTestID="home-recovery-status"
              rowTestID="screen-waiting-own-phone"
            />
            <Card>
              <Title>{copy.home.recoveryCardTitle}</Title>
              <Muted>{copy.home.recoveryCardBody}</Muted>
              <Button label={copy.home.recoveryCardAction} onPress={noop} />
            </Card>
          </>
        ) : null}
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Overline tone="terracotta">{homeDateOverline(now)}</Overline>
            <Display testID="home-greeting">{homeGreeting(now)}</Display>
            <DisplayItalic testID="home-family-name" tone="primary">
              {homeFamilyLine('Rivera')}
            </DisplayItalic>
          </View>
          <Pressable
            testID="home-avatars"
            accessibilityRole="button"
            accessibilityLabel={copy.home.avatarsLabel}
            onPress={noop}
            style={styles.avatars}
          >
            <AvatarStack people={previewPeople} />
          </Pressable>
        </View>
        <HomeSyncCard
          admin
          hasSchedule
          overline={overline}
          title="Household meeting"
          body="4 items on the agenda, plus 1 decision waiting."
          canAddItem
          onSetUp={noop}
          onReview={noop}
          onAddItem={noop}
        />
        <OnThisDayCard
          pick={{ item: previewMemory, yearsAgo: 5 }}
          previewSource={PREVIEW_THUMB}
          onOpen={noop}
        />
        <ThisWeekTasks
          tasks={previewTasks}
          people={peopleLookup}
          userId="u-elena"
          admin
          timeZone="America/Toronto"
          loading={false}
          failed={false}
          toggleError={null}
          now={new Date('2026-10-25T19:00:00')}
          onToggle={noop}
          onSeeAll={noop}
        />
      </Screen>
      <TabBar active="home" onSelect={noop} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
  },
  headerCopy: {
    flex: 1,
    gap: space.xxs,
  },
  avatars: {
    minHeight: 44,
    justifyContent: 'center',
  },
});

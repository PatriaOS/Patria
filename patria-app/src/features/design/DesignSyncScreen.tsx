import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { AddAgendaForm } from '../sync/AddAgendaForm';
import { SyncHubView, type SyncHubViewProps } from '../sync/SyncHubView';
import type { SyncAgendaKind } from '../sync/syncSchedule';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme';
import { Avatar, Body, Card, Display, Muted, Screen, TabBar } from '../../ui';
import { parsePreviewScale, parsePreviewScheme } from './DesignGalleryScreen';

const noop = () => undefined;

const hubAgenda: SyncHubViewProps['agenda'] = [
  {
    id: 'a1',
    title: 'Soccer carpool on Thursday',
    body: 'Marco can drive if Elena takes the way home.',
    kind: 'discuss',
    kindLabel: copy.sync.kinds.discuss,
    editable: true,
  },
  {
    id: 'a2',
    title: 'Sofia passed her swim test',
    body: 'Added by Sofia',
    kind: 'win',
    kindLabel: copy.sync.kinds.win,
    editable: false,
  },
  {
    id: 'a3',
    title: 'Renew the passports',
    body: 'Added by Elena Rivera',
    kind: 'decide',
    kindLabel: copy.sync.kinds.decide,
    editable: true,
  },
  {
    id: 'a4',
    title: 'Plan the spring picnic',
    body: 'Added by Marco',
    kind: 'plan',
    kindLabel: copy.sync.kinds.plan,
    editable: true,
  },
];

const hubBase: SyncHubViewProps = {
  admin: true,
  hasSchedule: true,
  hasMeeting: true,
  circleName: 'Household',
  whenLabel: 'Sun 7:00 PM',
  countdown: 'TONIGHT',
  canContinue: true,
  missed: false,
  runnerName: null,
  flowStepIndex: null,
  agenda: hubAgenda,
  busy: false,
  error: null,
  onSetUp: noop,
  onContinue: noop,
  onHoldNow: noop,
  onNextDate: noop,
  onFollow: noop,
  onAddAgenda: noop,
  onSchedule: noop,
  onPast: noop,
  onTasks: noop,
  onOpenItem: noop,
};

const previewMembers = [
  { id: 'u-elena', name: 'Elena Rivera', role: 'Family admin' },
  { id: 'u-marco', name: 'Marco Rivera', role: 'Co admin' },
  { id: 'u-rosa', name: 'Rosa Rivera', role: 'Elder' },
  { id: 'c-sofia', name: 'Sofia', role: 'Child' },
  { id: 'c-mateo', name: 'Mateo', role: 'Child' },
];

export const SYNC_PREVIEW_VIEWS = [
  'hub',
  'empty',
  'following',
  'missed',
  'meeting',
  'add',
  'members',
] as const;
type PreviewView = (typeof SYNC_PREVIEW_VIEWS)[number];

function parseView(value: string | string[] | undefined): PreviewView {
  const raw = Array.isArray(value) ? value[0] : value;
  return SYNC_PREVIEW_VIEWS.find((view) => view === raw) ?? 'hub';
}

export function DesignSyncScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <PreviewBody />;
}

function PreviewBody() {
  const { setPreviewScale, setPreviewScheme } = useTheme();
  const params = useLocalSearchParams<{ appearance?: string; scale?: string; view?: string }>();
  const view = parseView(params.view);
  const [kind, setKind] = useState<SyncAgendaKind>('discuss');
  const [title, setTitle] = useState('Soccer carpool on Thursday');
  const [details, setDetails] = useState('');
  const [addedBy, setAddedBy] = useState<string | null>(null);

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

  const peerIds = previewMembers.map((member) => member.id);

  const showTabBar = view === 'hub' || view === 'meeting' || view === 'members';
  const { colors } = useTheme();

  let body: React.ReactNode;
  if (view === 'members') {
    body = (
      <>
        <Display>{copy.tabs.family}</Display>
        {previewMembers.map((member) => (
          <Card key={member.id}>
            <View style={styles.memberRow}>
              <Avatar id={member.id} name={member.name} peerIds={peerIds} size={40} decorative />
              <View style={styles.memberCopy}>
                <Body>{member.name}</Body>
                <Muted>{member.role}</Muted>
              </View>
            </View>
          </Card>
        ))}
      </>
    );
  } else if (view === 'add') {
    body = (
      <AddAgendaForm
        kind={kind}
        title={title}
        details={details}
        titleError={false}
        addedById={addedBy}
        addedByOptions={[
          { id: 'c1', label: 'Sofia' },
          { id: 'c2', label: 'Mateo' },
        ]}
        selfLabel="Elena (you)"
        selfId="u-elena"
        showAddedBy
        editing={false}
        busy={false}
        error={null}
        meetingSubtitle="For Sunday’s Household meeting"
        onKind={setKind}
        onTitle={setTitle}
        onDetails={setDetails}
        onAddedBy={setAddedBy}
        onSave={noop}
        onCancel={noop}
      />
    );
  } else if (view === 'empty') {
    body = <SyncHubView {...hubBase} hasSchedule={false} />;
  } else if (view === 'following') {
    body = <SyncHubView {...hubBase} countdown={null} canContinue={false} runnerName="Marco" />;
  } else if (view === 'missed') {
    body = <SyncHubView {...hubBase} countdown={null} missed />;
  } else if (view === 'meeting') {
    body = <SyncHubView {...hubBase} countdown={null} canContinue flowStepIndex={1} />;
  } else {
    body = <SyncHubView {...hubBase} />;
  }

  return (
    <View style={[styles.shell, { backgroundColor: colors.background }]} testID="design-sync">
      <Screen
        withHeader={view === 'add'}
        withTabBar={showTabBar}
        accessibilityLabel={copy.sync.previewTitle}
      >
        {body}
      </Screen>
      {showTabBar ? <TabBar active="sync" onSelect={noop} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  memberCopy: {
    flex: 1,
    gap: 2,
  },
});

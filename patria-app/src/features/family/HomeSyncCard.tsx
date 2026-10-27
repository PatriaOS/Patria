import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { Body, Button, Card, Overline, Title } from '../../ui';
import { space } from '../../theme/tokens';

export type HomeSyncCardProps = {
  admin: boolean;
  hasSchedule: boolean;
  overline: string;
  title: string;
  body: string;
  canAddItem: boolean;
  onSetUp: () => void;
  onReview: () => void;
  onAddItem: () => void;
};

/** Family Sync hero on Home Today — tone hero (green box, mustard CTA). */
export function HomeSyncCard(props: HomeSyncCardProps) {
  if (!props.hasSchedule) {
    return (
      <Card tone="hero" testID="home-sync-card">
        <Overline>{copy.home.syncOverlineLabel}</Overline>
        <Title>{copy.sync.lead}</Title>
        <Body>{props.admin ? copy.sync.setUpBody : copy.sync.askAdminSetup}</Body>
        {props.admin ? (
          <Button
            label={copy.sync.setUpOurSync}
            compact
            testID="home-sync-set-up"
            onPress={props.onSetUp}
          />
        ) : null}
      </Card>
    );
  }

  return (
    <Card tone="hero" testID="home-sync-card">
      <Overline testID="home-sync-overline">{props.overline}</Overline>
      <Title testID="home-sync-title">{props.title}</Title>
      <Body testID="home-sync-body">{props.body}</Body>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label={copy.home.syncReviewAgenda}
            compact
            testID="home-sync-review"
            onPress={props.onReview}
          />
        </View>
        {props.canAddItem ? (
          <View style={styles.action}>
            <Button
              label={copy.home.syncAddItem}
              variant="ghost"
              compact
              testID="home-sync-add"
              onPress={props.onAddItem}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  action: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 140,
  },
});

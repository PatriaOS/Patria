import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { Body, Button, Card, Overline, Title } from '../../ui';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme';

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

/** Family Sync hero on Home Today (D35). */
export function HomeSyncCard(props: HomeSyncCardProps) {
  const { colors } = useTheme();

  if (!props.hasSchedule) {
    return (
      <Card variant="hero" testID="home-sync-card">
        <Overline color={colors.accentMustard}>{copy.home.syncOverlineLabel}</Overline>
        <Title color={colors.heroCardText}>{copy.sync.lead}</Title>
        <Body color={colors.heroCardText}>
          {props.admin ? copy.sync.setUpBody : copy.sync.askAdminSetup}
        </Body>
        {props.admin ? (
          <Button
            label={copy.sync.setUpOurSync}
            variant="accent"
            compact
            testID="home-sync-set-up"
            onPress={props.onSetUp}
          />
        ) : null}
      </Card>
    );
  }

  return (
    <Card variant="hero" testID="home-sync-card">
      <Overline color={colors.accentMustard} testID="home-sync-overline">
        {props.overline}
      </Overline>
      <Title color={colors.heroCardText} testID="home-sync-title">
        {props.title}
      </Title>
      <Body color={colors.heroCardText} testID="home-sync-body">
        {props.body}
      </Body>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label={copy.home.syncReviewAgenda}
            variant="accent"
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
              onHero
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

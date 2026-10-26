import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { Body, Card, Caption, Overline, PhotoTile } from '../../ui';
import { space } from '../../theme/tokens';
import { formatDuration } from '../memories/shareMessages';
import { yearsAgoLabel, type OnThisDayPick } from './onThisDay';

const THUMB_SIZE = 88;

type Props = {
  pick: OnThisDayPick;
  onOpen: (itemId: string) => void;
  /** Optional bundled preview asset when `thumbUrl` is missing (design fixtures). */
  previewSource?: number;
};

/** Soft "On this day" card; the whole card opens the memory. Only rendered when a memory exists. */
export function OnThisDayCard({ pick, onOpen, previewSource }: Props) {
  const { item, yearsAgo } = pick;
  const when = yearsAgoLabel(yearsAgo);
  const isVideo = item.kind === 'video';
  const duration = isVideo ? formatDuration(item.durationSeconds) : '';
  const kindLabel = isVideo
    ? copy.home.onThisDayVideo.replace('{duration}', duration)
    : copy.home.onThisDayPhoto;
  const headline = item.caption?.trim() || item.uploaderName;
  const what = `${headline}. ${kindLabel}, ${item.circleName}`;
  const uri = item.thumbUrl ?? undefined;

  return (
    <Card
      variant="soft"
      testID="home-on-this-day"
      accessibilityLabel={copy.home.onThisDayLabel.replace('{when}', when).replace('{what}', what)}
      onPress={() => onOpen(item.id)}
    >
      <Overline tone="terracotta">{`${copy.home.onThisDay} · ${when}`}</Overline>
      <View style={styles.row}>
        <PhotoTile
          testID={`home-on-this-day-${item.id}`}
          uri={uri}
          source={uri ? undefined : previewSource}
          size={THUMB_SIZE}
          accessibilityLabel={what}
          durationLabel={isVideo && duration ? duration : undefined}
        />
        <View style={styles.copy}>
          <Body>{headline}</Body>
          <Caption tone="muted">
            {item.caption?.trim() ? `${item.uploaderName} · ${item.circleName}` : item.circleName}
          </Caption>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
});

import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Body, Button, Card, Muted, Overline, PhotoTile, Pressable, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { space } from '../../theme/tokens';
import type { MemoryItem } from '../memories/memoryApi';
import { yearsAgoLabel, type OnThisDayPick } from './onThisDay';

const COLS = 3;
const GAP = space.xs;
const MAX = 6;

type Props = {
  items: MemoryItem[];
  onThisDay: OnThisDayPick | null;
  loading: boolean;
  failed: boolean;
  canAdd: boolean;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
  onAdd: () => void;
  onRetry: () => void;
  onOpenOnThisDay: (id: string) => void;
};

/** Memories — tone surface (white box, green CTA). */
export function HomeMemoriesCard(props: Props) {
  const [gridWidth, setGridWidth] = useState(0);

  if (props.loading) {
    return (
      <Card tone="surface" testID="home-memories-loading">
        <Muted>{copy.common.loading}</Muted>
      </Card>
    );
  }

  if (props.failed) {
    return (
      <Card tone="surface" testID="home-memories-error">
        <Muted>{copy.home.memoriesCardFailed}</Muted>
        <Button label={copy.home.cardRetry} variant="secondary" onPress={props.onRetry} />
      </Card>
    );
  }

  if (props.items.length === 0) {
    return (
      <Card tone="surface" testID="home-memories-empty">
        <Overline>{copy.home.memoriesCardOverline}</Overline>
        <Title>{copy.home.memoriesCardEmptyTitle}</Title>
        <Body>{copy.home.memoriesCardEmptyBody}</Body>
        {props.canAdd ? (
          <Button
            label={copy.home.memoriesCardAdd}
            testID="home-memories-add"
            onPress={props.onAdd}
          />
        ) : (
          <Muted>{copy.home.memoriesCardAskAdmin}</Muted>
        )}
      </Card>
    );
  }

  const shown = props.items.slice(0, MAX);
  const otd = props.onThisDay;
  const onGridLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - gridWidth) > 0.5) {
      setGridWidth(next);
    }
  };
  const tileSize =
    gridWidth > 0 ? Math.floor((gridWidth - GAP * (COLS - 1)) / COLS) : Math.floor(96);

  return (
    <Card tone="surface" testID="home-memories-card">
      <View style={styles.header}>
        <Overline>{copy.home.memoriesCardOverline}</Overline>
        <Pressable
          testID="home-memories-see-all"
          accessibilityRole="link"
          accessibilityLabel={copy.home.seeAll}
          onPress={props.onSeeAll}
          style={styles.seeAll}
        >
          <Body tone="primary">{copy.home.seeAll}</Body>
        </Pressable>
      </View>
      {otd ? (
        <Pressable
          testID="home-on-this-day"
          accessibilityRole="button"
          accessibilityLabel={copy.home.memoriesOnThisDay.replace(
            '{when}',
            yearsAgoLabel(otd.yearsAgo),
          )}
          onPress={() => props.onOpenOnThisDay(otd.item.id)}
          style={styles.onThisDay}
        >
          <Body tone="primary">
            {copy.home.memoriesOnThisDay.replace('{when}', yearsAgoLabel(otd.yearsAgo))}
          </Body>
        </Pressable>
      ) : null}
      <View style={styles.grid} onLayout={onGridLayout} testID="home-memories-grid">
        {shown.map((item) => (
          <PhotoTile
            key={item.id}
            testID={`home-memory-${item.id}`}
            uri={item.thumbUrl ?? undefined}
            size={tileSize}
            accessibilityLabel={item.caption?.trim() || item.uploaderName}
            durationLabel={
              item.kind === 'video' && item.durationSeconds != null
                ? `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, '0')}`
                : undefined
            }
            onPress={() => props.onOpen(item.id)}
          />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
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
  onThisDay: {
    minHeight: 44,
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
});

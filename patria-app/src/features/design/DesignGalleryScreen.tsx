import { Redirect, useLocalSearchParams } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { copy } from '../../lib/copy';
import { useTheme, type ResolvedScheme } from '../../theme';
import { space } from '../../theme/tokens';
import {
  Avatar,
  AvatarStack,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  IconButton,
  IconCircle,
  ListRow,
  PhotoTile,
  Screen,
  Skeleton,
  StatusPill,
  TabBar,
  type TabKey,
  Body,
  Caption,
  Display,
  Overline,
  Section,
  Small,
  Title,
  TextField,
  UnderlineTabs,
} from '../../ui';

export function DesignGalleryScreen() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <GalleryBody />;
}

function parsePreviewScheme(value: string | string[] | undefined): ResolvedScheme | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'light' || raw === 'dark' ? raw : null;
}

function parsePreviewScale(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'max' || raw === '1.3') {
    return 1.3;
  }
  if (raw === '1' || raw === 'default') {
    return 1;
  }
  return null;
}

function GalleryBody() {
  const { colors, setPreviewScale, setPreviewScheme, previewScale, scheme } = useTheme();
  const params = useLocalSearchParams<{ appearance?: string; scale?: string }>();
  const [filter, setFilter] = useState('week');
  const [tab, setTab] = useState<TabKey>('memories');

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

  const setScheme = (next: ResolvedScheme) => {
    setPreviewScheme(next);
  };

  return (
    <Screen withHeader testID="design-gallery" accessibilityLabel={copy.design.galleryTitle}>
      <Overline tone="terracotta">{copy.appName}</Overline>
      <Display>{copy.design.galleryTitle}</Display>
      <Body tone="muted">{copy.design.galleryLead}</Body>

      <View style={styles.row}>
        <Button
          label={copy.design.light}
          variant={scheme === 'light' ? 'primary' : 'ghost'}
          onPress={() => setScheme('light')}
        />
        <Button
          label={copy.design.dark}
          variant={scheme === 'dark' ? 'primary' : 'ghost'}
          onPress={() => setScheme('dark')}
        />
      </View>
      <View style={styles.row}>
        <Button
          label={copy.design.scaleDefault}
          variant={previewScale === 1 ? 'primary' : 'ghost'}
          onPress={() => setPreviewScale(1)}
        />
        <Button
          label={copy.design.scaleMax}
          variant={previewScale > 1 ? 'primary' : 'ghost'}
          onPress={() => setPreviewScale(1.3)}
        />
      </View>

      <Section>{copy.design.sectionType}</Section>
      <Title>Good evening, the Rivera family</Title>
      <Body>Household is the people who live together.</Body>
      <Small tone="muted">Only they will see this unless you pick another circle.</Small>
      <Caption tone="muted">No location is stored with this photo.</Caption>

      <Section>{copy.design.sectionColor}</Section>
      <View style={styles.swatches}>
        {(
          [
            ['background', colors.background],
            ['surface', colors.surface],
            ['primary', colors.primary],
            ['terracotta', colors.accentTerracotta],
            ['mustard', colors.accentMustard],
          ] as const
        ).map(([name, hex]) => (
          <View key={name} style={[styles.swatch, { backgroundColor: hex, borderColor: colors.hairline }]} />
        ))}
      </View>

      <Section>{copy.design.sectionComponents}</Section>
      <Card variant="hero">
        <Overline color={colors.heroCardText}>{copy.design.heroTitle}</Overline>
        <Title color={colors.heroCardText}>{copy.design.heroBody}</Title>
      </Card>
      <Card>
        <View style={styles.row}>
          <StatusPill label={copy.design.pillReady} tone="success" />
          <StatusPill label={copy.design.pillWait} tone="wait" />
        </View>
        <UnderlineTabs
          items={[
            { key: 'week', label: 'This week' },
            { key: 'later', label: 'Later' },
          ]}
          selected={filter}
          onSelect={setFilter}
        />
        <ListRow title={copy.design.listTitle} body={copy.design.listBody} />
      </Card>
      <Card variant="soft">
        <View style={styles.row}>
          <Avatar name="Elena Rivera" />
          <AvatarStack names={['Elena Rivera', 'Marco Rivera', 'Sofia Rivera']} />
          <IconCircle icon={Settings} />
          <IconButton icon={Settings} accessibilityLabel={copy.design.iconOnly} onPress={() => undefined} />
        </View>
        <PhotoTile accessibilityLabel={copy.design.photoLabel} durationLabel={copy.design.videoLength} />
      </Card>

      <Button label={copy.design.primaryAction} onPress={() => undefined} />
      <Button label={copy.design.accentAction} variant="accent" onPress={() => undefined} />
      <Button label={copy.design.ghostAction} variant="ghost" onPress={() => undefined} />
      <Button label={copy.design.dangerAction} variant="danger" onPress={() => undefined} />
      <Button label={copy.common.loading} busy onPress={() => undefined} />

      <TextField label={copy.design.fieldLabel} placeholder={copy.design.fieldPlaceholder} />
      <TextField label={copy.design.fieldLabel} error={copy.design.fieldError} value="" />

      <Banner tone="info" message={copy.design.bannerInfo} />
      <Banner tone="warning" message={copy.design.bannerWarning} />
      <Banner tone="danger" message={copy.design.bannerDanger} />

      <Skeleton height={18} />
      <Divider />
      <EmptyState title={copy.design.emptyTitle} message={copy.design.emptyBody} />

      <TabBar active={tab} onSelect={setTab} homeNoticeCount={1} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  swatches: {
    flexDirection: 'row',
    gap: space.sm,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
  },
});

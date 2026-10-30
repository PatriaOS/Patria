import { StyleSheet, Text, View } from 'react-native';

import { Body, Screen, Section, Title } from '../../ui';
import { useTheme } from '../../theme';
import { space } from '../../theme/tokens';
import type { TrustBlock, TrustDocument, TrustInline } from './trustContent';

type Props = {
  document: TrustDocument;
  testID: string;
  accessibilityLabel: string;
};

function InlineSpans({ spans }: { spans: TrustInline[] }) {
  const { colors } = useTheme();
  return (
    <Body>
      {spans.map((span, index) =>
        span.bold ? (
          <Text key={index} style={{ fontWeight: '700', color: colors.text }}>
            {span.text}
          </Text>
        ) : (
          <Text key={index}>{span.text}</Text>
        ),
      )}
    </Body>
  );
}

function BlockView({ block }: { block: TrustBlock }) {
  if (block.type === 'h1') {
    return <Title>{block.text}</Title>;
  }
  if (block.type === 'h2') {
    return <Section>{block.text}</Section>;
  }
  if (block.type === 'h3') {
    return <Title>{block.text}</Title>;
  }
  if (block.type === 'lede') {
    return (
      <Body tone="muted" style={styles.lede}>
        {block.spans.map((span, index) =>
          span.bold ? (
            <Text key={index} style={styles.boldInline}>
              {span.text}
            </Text>
          ) : (
            <Text key={index}>{span.text}</Text>
          ),
        )}
      </Body>
    );
  }
  if (block.type === 'ul') {
    return (
      <View style={styles.list}>
        {block.items.map((item, index) => (
          <View key={index} style={styles.bulletRow}>
            <Body style={styles.bulletMark}>•</Body>
            <View style={styles.bulletBody}>
              <InlineSpans spans={item} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  return <InlineSpans spans={block.spans} />;
}

export function TrustDocumentView(props: Props) {
  const lastIndex = props.document.blocks.length - 1;
  return (
    <Screen withHeader testID={props.testID} accessibilityLabel={props.accessibilityLabel}>
      <View style={styles.stack}>
        {props.document.blocks.map((block, index) => (
          <View
            key={`${block.type}-${index}`}
            testID={index === lastIndex ? `${props.testID}-end` : undefined}
          >
            <BlockView block={block} />
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.md,
  },
  lede: {
    fontStyle: 'italic',
  },
  boldInline: {
    fontWeight: '700',
  },
  list: {
    gap: space.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  bulletMark: {
    width: 16,
  },
  bulletBody: {
    flex: 1,
  },
});

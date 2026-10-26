import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  Modal,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Body,
  Caption,
  IconButton,
  Muted,
  Pressable,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';
import { routes } from '../../lib/navigation';
import { testIdFromLabel } from '../../lib/testId';
import { signOutAndGoWelcome } from '../../lib/authSession';
import { supabase } from '../../lib/supabase';
import { wipeVaultAudioCache } from '../vault/vaultPlayback';
import { useTheme } from '../../theme';
import { radius, space } from '../../theme/tokens';
import { homeFamilyLine } from './homeGreeting';

const DRAWER_WIDTH = Math.min(320, Dimensions.get('window').width * 0.86);

type MenuItem =
  | { kind: 'link'; label: string; href: string; testID: string }
  | { kind: 'soon'; label: string; testID: string }
  | { kind: 'signOut' };

type Props = {
  open: boolean;
  onClose: () => void;
  displayName: string;
  familyName: string;
};

function buildItems(): MenuItem[] {
  return [
    { kind: 'link', label: copy.home.menuHome, href: routes.home, testID: 'menu-home' },
    { kind: 'link', label: copy.home.menuMemories, href: routes.memories, testID: 'menu-memories' },
    { kind: 'link', label: copy.home.menuSync, href: routes.sync, testID: 'menu-sync' },
    { kind: 'link', label: copy.home.menuVault, href: routes.vault, testID: 'menu-vault' },
    { kind: 'link', label: copy.home.menuFamily, href: routes.family, testID: 'menu-family' },
    { kind: 'soon', label: copy.home.menuProfile, testID: 'menu-profile' },
    {
      kind: 'link',
      label: copy.home.menuSettings,
      href: routes.appearance,
      testID: 'menu-settings',
    },
    { kind: 'soon', label: copy.home.menuNotifications, testID: 'menu-notifications' },
    { kind: 'soon', label: copy.home.menuPrivacySecurity, testID: 'menu-privacy-security' },
    { kind: 'soon', label: copy.home.menuHelp, testID: 'menu-help' },
    { kind: 'soon', label: copy.home.menuFeedback, testID: 'menu-feedback' },
    { kind: 'soon', label: copy.home.menuAbout, testID: 'menu-about' },
    { kind: 'soon', label: copy.home.menuTerms, testID: 'menu-terms' },
    { kind: 'soon', label: copy.home.menuPrivacyPolicy, testID: 'menu-privacy-policy' },
    { kind: 'signOut' },
  ];
}

export function HomeMenuDrawer(props: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [slide] = useState(() => new Animated.Value(DRAWER_WIDTH));
  const [dim] = useState(() => new Animated.Value(0));
  const closing = useRef(false);
  const version =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '1.0.0';

  const finishClose = useCallback(() => {
    setVisible(false);
    closing.current = false;
    props.onClose();
  }, [props]);

  const animateClose = useCallback(() => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    Animated.parallel([
      Animated.timing(slide, { toValue: DRAWER_WIDTH, duration: 200, useNativeDriver: true }),
      Animated.timing(dim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => finishClose());
  }, [dim, finishClose, slide]);

  useEffect(() => {
    if (!props.open) {
      if (visible) {
        animateClose();
      }
      return;
    }
    // Mount then slide in — external open prop is the source of truth.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open the modal before animating
    setVisible(true);
    closing.current = false;
    slide.setValue(DRAWER_WIDTH);
    dim.setValue(0);
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(dim, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [props.open, visible, animateClose, dim, slide]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      animateClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, animateClose]);

  const swipeStartX = useRef(0);

  const onNavigate = (href: string) => {
    animateClose();
    router.push(href as never);
  };

  const onSignOut = () => {
    Alert.alert(copy.home.signOutConfirmTitle, copy.home.signOutConfirmBody, [
      { text: copy.common.cancel, style: 'cancel' },
      {
        text: copy.home.signOutConfirm,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            animateClose();
            // Temp decrypted audio files only; titles live in React state and clear on unmount.
            await wipeVaultAudioCache();
            await signOutAndGoWelcome({
              signOut: () => supabase.auth.signOut(),
              replace: (href) => router.replace(href),
            });
          })();
        },
      },
    ]);
  };

  if (!visible) {
    return null;
  }

  const familyLine = homeFamilyLine(props.familyName);
  const name = memberDisplayName(props.displayName);

  return (
    <Modal visible transparent animationType="none" onRequestClose={animateClose}>
      <View style={styles.root} testID="home-menu-drawer">
        <Pressable
          testID="home-menu-backdrop"
          accessibilityRole="button"
          accessibilityLabel={copy.home.closeMenu}
          onPress={animateClose}
          style={StyleSheet.absoluteFill}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: colors.text,
                opacity: dim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }),
              },
            ]}
          />
        </Pressable>
        <Animated.View
          onStartShouldSetResponder={() => true}
          onResponderGrant={(event) => {
            swipeStartX.current = event.nativeEvent.pageX;
          }}
          onResponderRelease={(event) => {
            if (event.nativeEvent.pageX - swipeStartX.current > 64) {
              animateClose();
            }
          }}
          style={[
            styles.drawer,
            {
              width: DRAWER_WIDTH,
              backgroundColor: colors.surface,
              paddingTop: insets.top + space.sm,
              paddingBottom: insets.bottom + space.md,
              transform: [{ translateX: slide }],
            },
          ]}
        >
          <View style={styles.drawerHeader}>
            <View style={styles.identity}>
              <Avatar name={name} />
              <View style={styles.identityCopy}>
                <Title>{name}</Title>
                <Muted>{familyLine}</Muted>
              </View>
            </View>
            <IconButton
              icon={X}
              accessibilityLabel={copy.home.closeMenu}
              testID="home-menu-close"
              onPress={animateClose}
            />
          </View>
          <View style={styles.items}>
            {buildItems().map((item) => {
              if (item.kind === 'signOut') {
                return (
                  <Pressable
                    key="sign-out"
                    testID="menu-sign-out"
                    accessibilityRole="button"
                    accessibilityLabel={copy.auth.signOut}
                    onPress={onSignOut}
                    style={styles.item}
                  >
                    <Body tone="danger">{copy.auth.signOut}</Body>
                  </Pressable>
                );
              }
              if (item.kind === 'soon') {
                return (
                  <View
                    key={item.testID}
                    testID={item.testID}
                    accessibilityLabel={`${item.label}, ${copy.home.menuSoon}`}
                    style={styles.item}
                  >
                    <Body tone="muted">{item.label}</Body>
                    <View style={[styles.soon, { backgroundColor: colors.softSurface }]}>
                      <Caption tone="muted">{copy.home.menuSoon}</Caption>
                    </View>
                  </View>
                );
              }
              return (
                <Pressable
                  key={item.testID}
                  testID={item.testID}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => onNavigate(item.href)}
                  style={styles.item}
                >
                  <Body>{item.label}</Body>
                </Pressable>
              );
            })}
          </View>
          <Caption tone="muted" testID={testIdFromLabel(copy.home.menuVersion)}>
            {copy.home.menuVersion.replace('{version}', version)}
          </Caption>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawer: {
    height: '100%',
    paddingHorizontal: space.card,
    gap: space.md,
    borderTopLeftRadius: radius.card,
    borderBottomLeftRadius: radius.card,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  identityCopy: {
    flex: 1,
    gap: space.xxs,
  },
  items: {
    flexGrow: 1,
    gap: space.xxs,
  },
  item: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  soon: {
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: space.xxs,
    overflow: 'hidden',
  },
});

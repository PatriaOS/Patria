import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Body,
  Button,
  ButtonStack,
  Caption,
  Divider,
  IconButton,
  Muted,
  Pressable,
  Title,
} from '../../ui';
import { copy } from '../../lib/copy';
import { memberDisplayName } from '../../lib/displayName';
import { routes } from '../../lib/navigation';
import { testIdFromLabel } from '../../lib/testId';
import { wipeVaultAudioCache } from '../vault/vaultPlayback';
import { useTheme } from '../../theme';
import { radius, space } from '../../theme/tokens';
import { homeFamilyLine } from './homeGreeting';

const DRAWER_WIDTH = Math.min(320, Dimensions.get('window').width * 0.86);

type MenuRow =
  | { kind: 'link'; label: string; href: string; testID: string; dot?: boolean }
  | { kind: 'soon'; label: string; testID: string }
  | { kind: 'divider' };

type Props = {
  open: boolean;
  onClose: () => void;
  displayName: string;
  familyName: string;
  privacyNeedsAttention?: boolean;
  onSignOut: () => void;
};

function buildRows(privacyNeedsAttention: boolean): MenuRow[] {
  return [
    { kind: 'link', label: copy.home.menuHome, href: routes.home, testID: 'menu-home' },
    { kind: 'link', label: copy.home.menuMemories, href: routes.memories, testID: 'menu-memories' },
    { kind: 'link', label: copy.home.menuSync, href: routes.sync, testID: 'menu-sync' },
    { kind: 'link', label: copy.home.menuVault, href: routes.vault, testID: 'menu-vault' },
    { kind: 'link', label: copy.home.menuFamily, href: routes.family, testID: 'menu-family' },
    { kind: 'divider' },
    { kind: 'soon', label: copy.home.menuProfile, testID: 'menu-profile' },
    {
      kind: 'link',
      label: copy.home.menuSettings,
      href: routes.appearance,
      testID: 'menu-settings',
    },
    { kind: 'soon', label: copy.home.menuNotifications, testID: 'menu-notifications' },
    {
      kind: 'link',
      label: copy.home.menuPrivacySecurity,
      href: routes.privacySecurity,
      testID: 'menu-privacy-security',
      dot: privacyNeedsAttention,
    },
    {
      kind: 'link',
      label: copy.home.menuPrivacyPolicy,
      href: routes.privacyStatement,
      testID: 'menu-privacy-policy',
    },
    { kind: 'divider' },
    { kind: 'soon', label: copy.home.menuHelp, testID: 'menu-help' },
    { kind: 'soon', label: copy.home.menuFeedback, testID: 'menu-feedback' },
    { kind: 'soon', label: copy.home.menuAbout, testID: 'menu-about' },
    { kind: 'divider' },
    { kind: 'soon', label: copy.home.menuTerms, testID: 'menu-terms' },
  ];
}

export function HomeMenuDrawer(props: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [slide] = useState(() => new Animated.Value(DRAWER_WIDTH));
  const [dim] = useState(() => new Animated.Value(0));
  const closing = useRef(false);
  const version =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '1.0.0';

  const finishClose = useCallback(() => {
    setVisible(false);
    setConfirmSignOut(false);
    closing.current = false;
    props.onClose();
  }, [props]);

  const animateClose = useCallback(() => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    setConfirmSignOut(false);
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
    // Push first so the destination mounts before the drawer finishes closing.
    router.push(href as never);
    animateClose();
  };

  const onSignOutPress = () => {
    setConfirmSignOut(true);
  };

  const onConfirmSignOut = () => {
    void (async () => {
      animateClose();
      await wipeVaultAudioCache();
      props.onSignOut();
    })();
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
              name="x"
              accessibilityLabel={copy.home.closeMenu}
              testID="home-menu-close"
              onPress={animateClose}
            />
          </View>
          {confirmSignOut ? (
            <View style={styles.confirm} testID="sign-out-confirm">
              <Title>{copy.home.signOutConfirmTitle}</Title>
              <Body>{copy.home.signOutConfirmBody}</Body>
              <ButtonStack>
                <Button
                  label={copy.home.signOutConfirm}
                  variant="danger"
                  testID="sign-out-confirm-yes"
                  onPress={onConfirmSignOut}
                />
                <Button
                  label={copy.common.cancel}
                  variant="secondary"
                  testID="sign-out-cancel"
                  onPress={() => setConfirmSignOut(false)}
                />
              </ButtonStack>
            </View>
          ) : (
            <>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                testID="home-menu-scroll"
              >
                {buildRows(Boolean(props.privacyNeedsAttention)).map((item, index) => {
                  if (item.kind === 'divider') {
                    return <Divider key={`divider-${index}`} />;
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
                      {item.dot ? (
                        <View
                          testID="menu-privacy-security-dot"
                          style={[styles.dot, { backgroundColor: colors.accentTerracotta }]}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
              {/* Pin Sign out + version under a divider so the list can scroll above them. */}
              <View style={styles.footer} testID="home-menu-footer">
                <Divider />
                <Pressable
                  testID="menu-sign-out"
                  accessibilityRole="button"
                  accessibilityLabel={copy.auth.signOut}
                  onPress={onSignOutPress}
                  style={styles.item}
                >
                  <Body tone="danger">{copy.auth.signOut}</Body>
                </Pressable>
                <Caption tone="muted" testID={testIdFromLabel(copy.home.menuVersion)}>
                  {copy.home.menuVersion.replace('{version}', version)}
                </Caption>
              </View>
            </>
          )}
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
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: space.xxs,
    // Leave room so Privacy Policy clears the pinned Sign out footer.
    paddingBottom: space.xxl + space.xl,
  },
  footer: {
    flexShrink: 0,
    gap: space.xxs,
  },
  confirm: {
    flex: 1,
    justifyContent: 'center',
    gap: space.sm,
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
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

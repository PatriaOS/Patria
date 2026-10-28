import { copy } from './copy';
import { light } from '../theme/tokens';

export const hiddenRootHeader = {
  headerShown: false,
  gestureEnabled: false,
  title: copy.appName,
  headerBackTitle: '',
  headerBackButtonDisplayMode: 'minimal',
} as const;

export const pushedScreenHeader = {
  headerShown: true,
  gestureEnabled: true,
  headerBackTitle: '',
  headerBackButtonDisplayMode: 'minimal',
  headerShadowVisible: false,
  headerTintColor: light.primary,
  headerStyle: { backgroundColor: light.background },
} as const;

export const screenTitles = {
  welcome: copy.welcome.title,
  signIn: copy.auth.signInTitle,
  signUp: copy.auth.signUpTitle,
  verify: copy.auth.verifyTitle,
  home: copy.appName,
  createFamily: copy.createFamily.title,
  ready: copy.ready.title,
  inviteSomeone: copy.invite.title,
  addChild: copy.child.title,
  member: copy.member.title,
  child: copy.child.title,
  inviteAccept: copy.invitePreview.title,
  joinFamily: copy.home.joinFamily,
  yourName: copy.auth.nameLabel,
  yourPhones: copy.phones.title,
  recoverySetup: copy.recovery.title,
  printedCode: copy.recovery.printedTitle,
  recoverLostPhone: copy.recovery.lostTitle,
  removeOldPhones: copy.recovery.removeOldTitle,
  memories: copy.memories.title,
  memoriesAdd: copy.memories.addPhotos,
  memoriesConnect: copy.memories.connectPhotos,
  memoriesConnectSettings: copy.memories.connectTitle,
  memoryItem: copy.memories.title,
  designGallery: copy.design.galleryTitle,
  sync: copy.tabs.sync,
  syncSchedule: copy.sync.scheduleTitle,
  syncAgenda: copy.sync.addToAgenda,
  syncRun: copy.sync.title,
  syncPast: copy.sync.pastMeetings,
  syncTasks: copy.sync.tasks,
  designSync: copy.sync.previewTitle,
  designHome: copy.design.homePreviewTitle,
  vault: copy.tabs.vault,
  vaultNew: copy.vault.newDecision,
  vaultEntry: copy.vault.title,
  family: copy.tabs.family,
  appearance: copy.appearance.title,
  needsYou: copy.home.needsYouTitle,
  privacySecurity: copy.home.privacySecurityTitle,
} as const;

export const routes = {
  gate: '/',
  welcome: '/(signed-out)/welcome',
  home: '/(signed-in)/home',
  createFamily: '/(signed-in)/create',
  inviteSomeone: '/(signed-in)/invite-someone',
  addChild: '/(signed-in)/add-child',
  member: (userId: string) => `/(signed-in)/member/${userId}` as const,
  inviteAccept: (token: string) => `/invite/${token}` as const,
  joinFamily: '/(signed-in)/join-family',
  yourName: '/(signed-in)/your-name',
  yourPhones: '/(signed-in)/your-phones',
  recoverySetup: '/(signed-in)/recovery-setup',
  printedCode: '/(signed-in)/printed-code',
  recoverLostPhone: '/(signed-in)/recover-lost-phone',
  removeOldPhones: '/(signed-in)/remove-old-phones',
  memories: '/(signed-in)/memories',
  memoriesAdd: '/(signed-in)/memories-add',
  memoriesConnect: '/(signed-in)/memories-connect',
  memoriesConnectSettings: '/(signed-in)/memories-connect-settings',
  memoryItem: (itemId: string) => `/(signed-in)/memory/${itemId}` as const,
  designGallery: '/design-gallery',
  sync: '/(signed-in)/sync',
  syncSchedule: '/(signed-in)/sync-schedule',
  syncAgenda: (itemId?: string) =>
    (itemId
      ? `/(signed-in)/sync-agenda?itemId=${encodeURIComponent(itemId)}`
      : '/(signed-in)/sync-agenda') as string,
  syncRun: '/(signed-in)/sync-run',
  syncPast: '/(signed-in)/sync-past',
  syncTasks: '/(signed-in)/sync-tasks',
  designSync: '/design-sync',
  designHome: '/design-home',
  vault: '/(signed-in)/vault',
  vaultNew: '/(signed-in)/vault-new',
  vaultEntry: (entryId: string) => `/(signed-in)/vault/${entryId}` as const,
  family: '/(signed-in)/family',
  appearance: '/(signed-in)/appearance',
  needsYou: '/(signed-in)/needs-you',
  privacySecurity: '/(signed-in)/privacy-security',
} as const;

export function headerWhenPushed(canGoBack: boolean) {
  return canGoBack ? pushedScreenHeader : hiddenRootHeader;
}

export function isRootWithoutBack(
  screen: 'welcome' | 'home' | 'create',
  canGoBack: boolean,
): boolean {
  if (screen === 'welcome' || screen === 'home') {
    return true;
  }
  return !canGoBack;
}

export function inviteAcceptBackHref(): '/' {
  return routes.gate;
}

/** Crossing signed-in / signed-out must not leave a swipe-back stack. */
export type AuthBoundaryNav = 'replace' | 'redirect';

export function authBoundaryNav(): AuthBoundaryNav {
  return 'replace';
}

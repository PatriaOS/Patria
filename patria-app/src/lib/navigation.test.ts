import {
  authBoundaryNav,
  headerWhenPushed,
  hiddenRootHeader,
  inviteAcceptBackHref,
  isRootWithoutBack,
  pushedScreenHeader,
  routes,
} from './navigation';

describe('navigation headers', () => {
  it('hides the header and back gesture on root screens', () => {
    expect(headerWhenPushed(false)).toBe(hiddenRootHeader);
    expect(hiddenRootHeader.headerShown).toBe(false);
    expect(hiddenRootHeader.gestureEnabled).toBe(false);
    expect(isRootWithoutBack('welcome', true)).toBe(true);
    expect(isRootWithoutBack('home', true)).toBe(true);
    expect(isRootWithoutBack('create', false)).toBe(true);
    expect(isRootWithoutBack('create', true)).toBe(false);
  });

  it('shows a back header and swipe gesture on pushed screens', () => {
    expect(headerWhenPushed(true)).toBe(pushedScreenHeader);
    expect(pushedScreenHeader.headerShown).toBe(true);
    expect(pushedScreenHeader.gestureEnabled).toBe(true);
    expect(pushedScreenHeader.headerBackButtonDisplayMode).toBe('minimal');
    expect(hiddenRootHeader.title).toBe('Patria');
    expect(hiddenRootHeader.title).not.toMatch(/signed-out|signed-in/);
    expect(headerWhenPushed(true)).toEqual(
      expect.objectContaining({
        headerShown: true,
        gestureEnabled: true,
      }),
    );
  });

  it('keeps compose invite off the accept-invite path', () => {
    expect(routes.inviteSomeone).toBe('/(signed-in)/invite-someone');
    expect(routes.inviteAccept('abc')).toBe('/invite/abc');
    expect(routes.joinFamily).toBe('/(signed-in)/join-family');
    expect(routes.yourName).toBe('/(signed-in)/your-name');
    expect(routes.yourPhones).toBe('/(signed-in)/your-phones');
    expect(routes.recoverySetup).toBe('/(signed-in)/recovery-setup');
    expect(routes.printedCode).toBe('/(signed-in)/printed-code');
    expect(routes.recoverLostPhone).toBe('/(signed-in)/recover-lost-phone');
    expect(routes.removeOldPhones).toBe('/(signed-in)/remove-old-phones');
    expect(routes.memories).toBe('/(signed-in)/memories');
    expect(routes.memoriesAdd).toBe('/(signed-in)/memories-add');
    expect(routes.memoriesConnect).toBe('/(signed-in)/memories-connect');
    expect(routes.memoriesConnectSettings).toBe('/(signed-in)/memories-connect-settings');
    expect(routes.memoryItem('abc')).toBe('/(signed-in)/memory/abc');
    expect(routes.appearance).toBe('/(signed-in)/appearance');
    expect(routes.family).toBe('/(signed-in)/family');
    expect(routes.vault).toBe('/(signed-in)/vault');
    expect(routes.vaultNew).toBe('/(signed-in)/vault-new');
    expect(routes.vaultEntry('abc')).toBe('/(signed-in)/vault/abc');
  });

  it('lets native back leave the invite screen', () => {
    expect(inviteAcceptBackHref()).toBe('/');
  });

  it('crosses signed-in and signed-out with replace, never push', () => {
    expect(authBoundaryNav()).toBe('replace');
    expect(authBoundaryNav()).not.toBe('push');
  });
});

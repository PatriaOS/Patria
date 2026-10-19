import { navigationChrome } from './navigationChrome';
import { dark, light } from './tokens';

describe('navigationChrome', () => {
  it('uses linen chrome and dark status-bar content in light', () => {
    const chrome = navigationChrome(light, 'light');
    expect(chrome.headerStyle.backgroundColor).toBe(light.background);
    expect(chrome.headerTitleStyle.color).toBe(light.text);
    expect(chrome.statusBar).toBe('dark');
  });

  it('uses dark chrome, cream title and light status-bar content in dark', () => {
    const chrome = navigationChrome(dark, 'dark');
    expect(chrome.headerStyle.backgroundColor).toBe(dark.background);
    expect(chrome.headerTitleStyle.color).toBe(dark.text);
    expect(chrome.statusBar).toBe('light');
  });
});

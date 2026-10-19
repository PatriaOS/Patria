import {
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
  useFonts as useCormorant,
} from '@expo-google-fonts/cormorant-garamond';
import { Manrope_400Regular, Manrope_500Medium, Manrope_700Bold, useFonts as useManrope } from '@expo-google-fonts/manrope';
import { useEffect, useState } from 'react';

import { FONT_LOAD_TIMEOUT_MS } from './tokens';

export function fontGateShouldContinue(loaded: boolean, failed: boolean, timedOut: boolean): boolean {
  return loaded || failed || timedOut;
}

export function useHeirloomFonts(): { ready: boolean; loaded: boolean } {
  const [cormorant, cormorantError] = useCormorant({
    CormorantGaramond_600SemiBold,
    CormorantGaramond_500Medium_Italic,
  });
  const [manrope, manropeError] = useManrope({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  });
  const loaded = Boolean(cormorant && manrope);
  const failed = Boolean(cormorantError || manropeError);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (loaded || failed) {
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [failed, loaded]);

  return { ready: fontGateShouldContinue(loaded, failed, timedOut), loaded };
}

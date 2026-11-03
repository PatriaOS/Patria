declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_E2E?: string;
    EXPO_PUBLIC_LETTER_RELEASE_PUBLIC_KEY_HEX?: string;
  }
}

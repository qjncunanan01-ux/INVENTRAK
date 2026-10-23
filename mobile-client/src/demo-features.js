// Demo-only screens are opt-in at bundle time and stay hidden in normal and
// production builds unless this flag is explicitly enabled.
export const DEMO_POLICY_PREVIEW_ENABLED = process.env.EXPO_PUBLIC_DEMO_POLICY_PREVIEW === 'true';

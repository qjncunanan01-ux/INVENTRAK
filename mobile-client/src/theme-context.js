// Dark-mode toggle for the mobile app. Screens import colors through
// useThemeColors() so the whole app flips when the user toggles the switch on
// the Account screen.
//
// On FIRST LAUNCH (no saved choice) the app follows the DEVICE's system color
// scheme via React Native's useColorScheme() — dark on a phone set to dark
// mode, light otherwise — and keeps following it live as the user changes the
// OS setting. The moment the user flips the Account-screen switch, that
// explicit choice is persisted (AsyncStorage) and overrides the system from
// then on.
//
// The palette objects live in theme.js: `colors` (light, the default) and
// `darkColors`. A screen's StyleSheet becomes a createStyles(colors) factory
// so React can rebuild it when the palette object identity changes.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { colors as lightColors, darkColors } from './theme';

// AsyncStorage is bundled with Expo Go; load it lazily so the app still boots
// if the package is ever missing (same pattern as api.js).
let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {}

const STORAGE_KEY = 'inventrak_dark_mode';

const ThemeContext = createContext({
  dark: false,
  colors: lightColors,
  toggleDark: () => {},
});

export function ThemeProvider({ children }) {
  // The device's light/dark system preference (null when unknown, e.g. some
  // web/headless environments — treat that as light).
  const systemDark = useColorScheme() === 'dark';

  // `dark` is the EFFECTIVE theme (system when no explicit choice, otherwise
  // the user's). `persistedChoice` is the explicit user choice, stored as
  // 'dark' | 'light' | null (= follow system). Persisting 'system' would be
  // indistinguishable from no choice, so the key is only ever written once the
  // user actually toggles — a fresh install always starts on the system theme.
  const [dark, setDark] = useState(() => systemDark);
  const [persistedChoice, setPersistedChoice] = useState(null);
  // `hydrated` gates persistence writes (see below) so a fast pre-hydration
  // toggle is never overwritten by the storage read resolving afterwards.
  const hydratedRef = useRef(false);
  // True once the user has an EXPLICIT choice: a saved value from a previous
  // session OR a toggle during this session. While false, the system
  // preference stays in effect (and keeps applying live). Once true, the
  // explicit choice wins and the system preference stops applying.
  const userToggledRef = useRef(persistedChoice !== null);

  // Restore a saved explicit choice once on boot. Only applies it when the
  // user has NOT already toggled during this session (the toggle wins).
  useEffect(() => {
    let mounted = true;
    if (AsyncStorage) {
      AsyncStorage.getItem(STORAGE_KEY)
        .then((v) => {
          if (!mounted || userToggledRef.current) return;
          if (v === '1') {
            setPersistedChoice('dark');
            setDark(true);
          } else if (v === '0') {
            setPersistedChoice('light');
            setDark(false);
          }
          // No saved key -> stay on the system theme (default).
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, []);

  // Follow the system theme live, but ONLY while the user has not made an
  // explicit choice. Once they toggle, the explicit choice takes over.
  useEffect(() => {
    if (persistedChoice === null) setDark(systemDark);
  }, [systemDark, persistedChoice]);

  const toggleDark = () => {
    userToggledRef.current = true;
    // `persistedChoice` lives in a different domain than `dark`: null means
    // "follow the system" (no explicit choice). The new EXPLICIT choice is
    // therefore the opposite of the EFFECTIVE dark flag when the user had no
    // choice yet — deriving it from persistedChoice alone would flip null to
    // 'dark' when the effective theme was dark (wrong: it must be 'light').
    setPersistedChoice((p) => (p !== null ? (p === 'dark' ? 'light' : 'dark') : dark ? 'light' : 'dark'));
    setDark((d) => !d);
  };

  // Persist the explicit choice on every change AFTER the boot read resolves
  // (side effect lives in an effect, not inside the setState updater).
  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    if (persistedChoice !== null && AsyncStorage) {
      AsyncStorage.setItem(STORAGE_KEY, persistedChoice === 'dark' ? '1' : '0').catch(() => {});
    }
  }, [persistedChoice]);

  const value = useMemo(
    () => ({ dark, colors: dark ? darkColors : lightColors, toggleDark }),
    [dark]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Returns { dark, colors, toggleDark }. `colors` is the active palette (light
// or dark) — pass it to createStyles(colors) in a useMemo.
export function useThemeColors() {
  return useContext(ThemeContext);
}

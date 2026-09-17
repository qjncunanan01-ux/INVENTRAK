// Dark-mode support for the staff app — same behavior as the customer app:
// follow the device's system scheme on first launch, persist an explicit
// Account-screen toggle (AsyncStorage) once the user makes one.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { colors as lightColors, darkColors } from './theme';

let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {}

const STORAGE_KEY = 'inventrak_staff_dark_mode';

const ThemeContext = createContext({
  dark: false,
  colors: lightColors,
  toggleDark: () => {},
});

export function ThemeProvider({ children }) {
  const systemDark = useColorScheme() === 'dark';

  const [dark, setDark] = useState(() => systemDark);
  const [persistedChoice, setPersistedChoice] = useState(null);
  const hydratedRef = useRef(false);
  const userToggledRef = useRef(persistedChoice !== null);

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
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (persistedChoice === null) setDark(systemDark);
  }, [systemDark, persistedChoice]);

  const toggleDark = () => {
    userToggledRef.current = true;
    setPersistedChoice((p) => (p !== null ? (p === 'dark' ? 'light' : 'dark') : dark ? 'light' : 'dark'));
    setDark((d) => !d);
  };

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

// Returns { dark, colors, toggleDark } — pass colors to createStyles(colors)
// in a useMemo so styles rebuild when the palette flips.
export function useThemeColors() {
  return useContext(ThemeContext);
}

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'inventrak_admin_mode';

const ThemeModeContext = createContext({ mode: 'light', toggleMode: () => {} });

// On FIRST LAUNCH (no saved choice) the admin follows the browser/OS color
// scheme via the `prefers-color-scheme` media query, and keeps following it
// live while the user changes the OS/browser setting. The moment the user
// clicks the sidebar toggle, that explicit light/dark choice is persisted
// (localStorage) and overrides the system from then on.
//
// `preferred` is the explicit user choice ('dark' | 'light') or null to follow
// the system; `mode` is the EFFECTIVE theme handed to the rest of the app.
// The storage key is only ever written once the user actually toggles, so a
// fresh browser always starts on the system theme.
function prefersDark() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function ThemeModeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark') return 'dark';
      if (saved === 'light') return 'light';
    } catch {}
    // No explicit choice yet -> follow the system theme.
    return prefersDark() ? 'dark' : 'light';
  });
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return null;
  });
  // True once the user has an EXPLICIT choice: a saved value from a previous
  // visit OR a toggle during this session. While false, the system preference
  // stays in effect (and keeps applying live). Once true, the explicit choice
  // wins and the system preference stops applying.
  const userToggledRef = useRef(preferred !== null);

  // Track the system preference live, but only while the user has not made an
  // explicit choice — the toggle overrides the system from then on.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (userToggledRef.current) return;
      setMode(e.matches ? 'dark' : 'light');
    };
    // apply the current value immediately (also covers a user who flips the
    // OS setting before this effect ever ran)
    if (!userToggledRef.current) setMode(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Persist the explicit choice whenever it changes (side effect in an
  // effect, not inside the setState updater — StrictMode double-invokes
  // updaters in dev).
  useEffect(() => {
    if (preferred !== null) {
      try {
        localStorage.setItem(STORAGE_KEY, preferred);
      } catch {}
    }
  }, [preferred]);

  const value = useMemo(() => {
    const toggleMode = () => {
      userToggledRef.current = true;
      // `preferred` lives in a different domain than `mode`: null means
      // "follow the system" (no explicit choice), while mode is always the
      // effective light/dark. The new EXPLICIT choice is therefore the
      // opposite of the EFFECTIVE mode when the user had no choice yet —
      // deriving it from `preferred` alone would flip null -> 'dark' when the
      // effective mode was dark (wrong: it must be 'light').
      setPreferred((p) => (p !== null ? (p === 'dark' ? 'light' : 'dark') : mode === 'light' ? 'dark' : 'light'));
      setMode((m) => (m === 'light' ? 'dark' : 'light'));
    };
    return { mode, toggleMode };
  }, [mode]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

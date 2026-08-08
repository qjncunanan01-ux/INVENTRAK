import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ThemeModeProvider, useThemeMode } from './theme-mode';

// Controllable prefers-color-scheme mock: tests flip `systemDark` and the
// provider's live listener fires the registered change handler.
let systemDark = false;
const listeners = new Set();
let systemDarkAtSubscribe = false;

function installMatchMediaMock() {
  window.matchMedia = (query) => {
    if (query !== '(prefers-color-scheme: dark)') {
      // Anything else (MUI's useMediaQuery etc.) just never matches.
      return { matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} };
    }
    return {
      get matches() {
        return systemDarkAtSubscribe;
      },
      media: query,
      addEventListener: (type, cb) => listeners.add(cb),
      removeEventListener: (type, cb) => listeners.delete(cb),
      dispatchEvent: () => false,
    };
  };
}

function setSystemDark(v) {
  systemDarkAtSubscribe = v;
  listeners.forEach((cb) => cb({ matches: v }));
}

function Probe() {
  const { mode, toggleMode } = useThemeMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={toggleMode}>toggle</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ThemeModeProvider>
      <Probe />
    </ThemeModeProvider>
  );
}

describe('ThemeModeProvider system preference', () => {
  beforeEach(() => {
    localStorage.clear();
    listeners.clear();
    installMatchMediaMock();
  });

  test('first launch follows the system theme (dark system -> dark app)', () => {
    setSystemDark(true);
    renderProbe();
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    // Nothing is persisted yet — the app is still "following the system".
    expect(localStorage.getItem('inventrak_admin_mode')).toBeNull();
  });

  test('first launch follows the system theme (light system -> light app)', () => {
    setSystemDark(false);
    renderProbe();
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(localStorage.getItem('inventrak_admin_mode')).toBeNull();
  });

  test('system preference changes apply live before any manual toggle', () => {
    setSystemDark(false);
    renderProbe();
    expect(screen.getByTestId('mode').textContent).toBe('light');
    act(() => setSystemDark(true));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(localStorage.getItem('inventrak_admin_mode')).toBeNull();
  });

  test('a saved explicit choice overrides the system on launch', () => {
    localStorage.setItem('inventrak_admin_mode', 'light');
    setSystemDark(true); // system says dark, but the user chose light
    renderProbe();
    expect(screen.getByTestId('mode').textContent).toBe('light');
  });

  test('manual toggle overrides the system and persists', async () => {
    setSystemDark(true);
    renderProbe();
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('mode').textContent).toBe('light');
    // The persistence side effect flushes after the state update.
    await waitFor(() => expect(localStorage.getItem('inventrak_admin_mode')).toBe('light'));
  });

  test('after a manual toggle the system preference no longer applies', () => {
    setSystemDark(false);
    renderProbe();
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    // OS flips to light, but the user's explicit choice stays.
    act(() => setSystemDark(false));
    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });
});

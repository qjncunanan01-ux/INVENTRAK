import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import LoginPage from './LoginPage';

// The web admin portal is a DESKTOP surface for the admin tier only
// (Owner / Super Admin / Admin). The role spec makes Inventory Staff a
// MOBILE role — QR scanning, counts, adjustment requests on the phone — so:
//   1. the login request carries portal: 'admin' (the backend refuses staff
//      with 403 portal_mobile_only when it sees this flag), and
//   2. the client hard-gates any non-admin-tier response as belt-and-braces.
// These tests lock both behaviors so the staff-is-mobile-only rule can't
// silently regress.

// vi.mock factories are hoisted above the top-level consts, so anything the
// factory closes over must be created inside vi.hoisted (runs first).
const { fetchMock, setToken } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  setToken: vi.fn(),
}));
vi.stubGlobal('fetch', fetchMock);

vi.mock('../api', () => ({
  API_BASE_URL: 'http://test-api',
  setToken,
  mfaVerify: vi.fn(),
  getMeta: vi.fn(() => Promise.reject(new Error('offline'))),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }) => <div>{children}</div>,
  },
}));

vi.mock('../components/ShaderGradientBg', () => ({
  default: () => null,
}));

vi.mock('../hooks/usePageTitle', () => ({
  default: () => {},
}));

function okSession(user) {
  return {
    ok: true,
    status: 200,
    json: async() => ({ token: 'tok-123', user }),
  };
}

function fillAndSubmit(username, password) {
  fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
}

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  setToken.mockClear();
  delete window.location;
  window.location = { href: '' };
});

describe('portal gate: the web admin is admin-tier only', () => {
  test('the login request carries portal: "admin"', async() => {
    fetchMock.mockResolvedValueOnce(okSession({ id: 4, username: 'owner', role: 'owner' }));
    render(<LoginPage onLogin={() => {}} />);
    fillAndSubmit('owner', 'owner123');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.portal).toBe('admin');
    expect(body.username).toBe('owner');
  });

  test('a backend 403 portal_mobile_only refusal is shown as a mobile pointer', async() => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async() => ({
        error: 'Inventory Staff accounts are mobile-only. Use the INVENTRAK mobile app to scan QR tags and submit counts.',
        code: 'portal_mobile_only',
      }),
    });
    render(<LoginPage onLogin={() => {}} />);
    fillAndSubmit('staff', 'staff123');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/mobile app/i);
    // No session may be stored from a refused login.
    expect(setToken).not.toHaveBeenCalled();
  });

  test('a non-admin-tier session (old backend) is blocked client-side', async() => {
    // An older backend without the portal flag would hand back a normal
    // staff session — the client gate must still stop it.
    fetchMock.mockResolvedValueOnce(
      okSession({ id: 3, username: 'staff', role: 'staff' }),
    );
    render(<LoginPage onLogin={() => {}} />);
    fillAndSubmit('staff', 'staff123');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/mobile app|web admin access/i);
    expect(setToken).not.toHaveBeenCalled();
  });

  test('admin-tier roles still sign in normally', async() => {
    for (const user of [
      { id: 4, username: 'owner', role: 'owner' },
      { id: 5, username: 'superadmin', role: 'super_admin' },
      { id: 1, username: 'admin', role: 'admin' },
    ]) {
      fetchMock.mockResolvedValueOnce(okSession(user));
      const { unmount } = render(<LoginPage onLogin={() => {}} />);
      fillAndSubmit(user.username, 'password1');
      await waitFor(() => expect(setToken).toHaveBeenCalledWith('tok-123'));
      unmount();
    }
  });
});

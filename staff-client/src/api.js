// INVENTRAK Staff — API facade.
//
// The generated module (api.generated.js, copied from the OpenAPI contract)
// is the source of truth for request shapes; this file keeps only what the
// STAFF app needs: session persistence (staff stay signed in between shifts —
// unlike the customer app, which is guest-first), the Render cold-start
// wake/retry wrapper, and ONLY the endpoints the server allows staff to call.
// Admin-only operations (sales, approvals, product management, analytics)
// are deliberately absent — importing one would be a bug the server 403s.
import { useEffect, useState } from 'react';
import { Platform, NativeModules } from 'react-native';
import { createApiClient } from './api.generated';

// Same base-URL resolution as the customer app: baked EXPO_PUBLIC_API_URL
// (production builds) → the Metro script host on :4001 (dev, same Wi-Fi) →
// emulator/simulator loopback fallbacks.
function resolveApiBaseUrl() {
  const deployed = process.env.EXPO_PUBLIC_API_URL;
  if (deployed && /^https?:\/\//i.test(deployed.trim())) {
    return deployed.trim().replace(/\/+$/, '');
  }
  try {
    const raw = NativeModules.SourceCode && NativeModules.SourceCode.scriptURL;
    if (typeof raw === 'string') {
      const normalized = raw.replace(/^[a-z]+:\/\//, 'http://');
      const host = normalized.match(/^https?:\/\/([^/:]+)/);
      if (host && host[1]) return `http://${host[1]}:4001`;
    }
  } catch {}
  return Platform.OS === 'android' ? 'http://10.0.2.2:4001' : 'http://localhost:4001';
}

let currentBaseUrl = resolveApiBaseUrl();

// toString()-backed holder so the generated client always interpolates the
// CURRENT base URL (lets the network-failure fallback below swap hosts at
// runtime without touching generated code).
const baseUrlHolder = { toString: () => currentBaseUrl };

export let API_BASE_URL = currentBaseUrl;

export function getApiBaseUrl() {
  return currentBaseUrl;
}

// Product photo paths from the API ('/images/<file>') → absolute URLs.
export function imageUrl(image) {
  if (!image) return null;
  return /^https?:\/\//i.test(image) ? image : currentBaseUrl + image;
}

let authToken = null;

// ---- Session persistence (AsyncStorage) ----
//
// Staff tool = a shift device. A warehouse worker should not re-type
// credentials every morning, so the session (token + identity + role) is
// persisted and restored at launch. Logout clears it. Only STAFF_TIER roles
// are ever persisted: if an admin-tier account signs in here the role is
// stored as-is (they outrank staff), but customers are refused at the
// login gate before a session can exist.
const SESSION_KEY = 'inventrak_staff_session_v1';

let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {}

function persistSession() {
  if (!AsyncStorage) return;
  AsyncStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      token: authToken,
      username: sessionUsername,
      email: sessionEmail,
      verified: sessionVerified,
      role: sessionRole,
    })
  ).catch(() => {});
}

function clearPersistedSession() {
  if (!AsyncStorage) return;
  AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
}

// Restored at boot (see hydrateSession below).
let sessionUsername = null;
let sessionEmail = null;
let sessionVerified = false;
// 'staff' | 'admin' | 'super_admin' | 'owner' — the staff tier. Every one of
// these roles may use this app; the login gate refuses anything else.
let sessionRole = null;

const sessionListeners = new Set();

// Restore the persisted session once at module load. AsyncStorage reads are
// async, so this flips a `hydrated` flag the App shell watches (via
// useSession()) before rendering the gated navigator — otherwise a slow
// storage read would flash the Login screen over a valid session.
let hydrated = false;
const hydrationListeners = new Set();

async function hydrateSession() {
  if (!AsyncStorage) {
    hydrated = true;
    hydrationListeners.forEach((fn) => fn());
    return;
  }
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.token && STAFF_TIER.includes(s.role)) {
        authToken = s.token;
        sessionUsername = s.username || null;
        sessionEmail = s.email || null;
        sessionVerified = !!s.verified;
        sessionRole = s.role;
      }
    }
  } catch {}
  hydrated = true;
  hydrationListeners.forEach((fn) => fn());
}

hydrateSession();

// True once the boot-time storage read has finished (session restored or not).
export function useSessionHydrated() {
  const [ready, setReady] = useState(hydrated);
  useEffect(() => {
    if (hydrated) {
      setReady(true);
      return;
    }
    hydrationListeners.add(onDone);
    return () => hydrationListeners.delete(onDone);
    function onDone() {
      setReady(true);
    }
  }, []);
  return ready;
}

export function setToken(token) {
  authToken = token;
  persistSession();
}

export function getToken() {
  return authToken;
}

export function clearToken() {
  authToken = null;
  clearPersistedSession();
}

export function setSessionUsername(name) {
  sessionUsername = name || null;
  persistSession();
  sessionListeners.forEach((fn) => fn());
}

// The staff tier: roles allowed to use this app. Mirrors the backend's
// STAFF_TIER (staff + every admin-tier role) — customers get a hard 403
// `staff_app_forbidden` at login.
export const STAFF_TIER = ['staff', 'admin', 'super_admin', 'owner'];

export function setSessionDetails({ email, verified, role }) {
  sessionEmail = email || null;
  sessionVerified = !!verified;
  if (STAFF_TIER.includes(role)) sessionRole = role;
  persistSession();
  sessionListeners.forEach((fn) => fn());
}

export function getSessionUsername() {
  return sessionUsername;
}

export function getSessionRole() {
  return sessionRole;
}

// Local-only logout: clears the persisted session. (The server-side token
// revocation happens through the `logout()` wrapper below.)
export function clearSession() {
  sessionUsername = null;
  sessionEmail = null;
  sessionVerified = false;
  sessionRole = null;
  clearPersistedSession();
  sessionListeners.forEach((fn) => fn());
}

export function subscribeSession(listener) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

// React hook bundling the session state screens care about (identity + role).
// Re-renders on every login/logout so gated UI flips instantly.
export function useSession() {
  const [, setTick] = useState(0);
  useEffect(() => subscribeSession(() => setTick((t) => t + 1)), []);
  return {
    username: sessionUsername,
    role: sessionRole,
    verified: sessionVerified,
    isLoggedIn: !!sessionUsername && !!authToken,
  };
}

// Shared client instance wired to this app's base URL + token store.
const rawClient = createApiClient({ baseUrl: baseUrlHolder, getToken });

// Render's free tier sleeps after ~15 minutes idle; the first request after a
// cold start can take 30-60s. Same defense as the customer app: a cheap
// wake-up probe fired at launch, and a retry wrapper for network-level
// failures (HTTP 4xx/5xx stay definitive — never retried).
export function wakeBackend() {
  const probe = `${currentBaseUrl}/api/openapi.json`;
  const tryWake = (attempt) => {
    fetch(probe, { method: 'GET' }).catch(() => {
      if (attempt < 3) setTimeout(() => tryWake(attempt + 1), 2000 * attempt);
    });
  };
  tryWake(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const client = {};
for (const key of Object.keys(rawClient)) {
  client[key] = async (...args) => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await rawClient[key](...args);
      } catch (err) {
        lastErr = err;
        if (err.status) throw err;
        if (attempt < 2) await sleep(1500 * (attempt + 1));
      }
    }
    throw lastErr;
  };
}

// Generic helpers (same signatures as the customer facade).
export const apiGet = client.apiGet;
export const apiPost = client.apiPost;

// ---- Auth ----
export const login = client.login;
export const logout = client.logout;

// ---- Staff surfaces (the ONLY data this app touches) ----
// Inventory levels per location (public) — the Count tab pre-fills from it.
export const getInventory = client.getInventory;
// Storage areas (public) — id map for the count form.
export const listLocations = client.listLocations;
// Stock lots (staff-readable) — best-before/expiry context per product.
export const listStockLots = client.listStockLots;
// OCR label scan WITH live per-location stock (staff+ endpoint) — the scan →
// verify → count flow.
export const ocrStockCheck = client.ocrStockCheck;
// Adjustments: staff CREATE (pending) and READ their own requests. Approve /
// reject are admin-only and are intentionally NOT exposed here.
export const createStockAdjustment = client.createStockAdjustment;
export const listStockAdjustments = client.listStockAdjustments;
// Audit: every QR/barcode scan lands in the server audit trail.
export const createScanEvent = client.createScanEvent;

// Server-side logout: revoke the session token, then clear the local session
// regardless of network state (a dead network must never trap a shift device
// in a signed-in state).
export async function logoutAndClear() {
  try {
    await client.logout();
  } catch {
    // Token may already be revoked/expired — local cleanup still proceeds.
  } finally {
    clearToken();
    clearSession();
  }
}

export default client;

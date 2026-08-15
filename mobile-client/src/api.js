// Thin facade over the OpenAPI-generated client (api.generated.js).
//
// The generated module (regenerated from backend/openapi.json via
// `npm run client:generate` in the backend) is the single source of truth for
// every API call, so the mobile app always matches the documented contract.
// Only the platform base URL and the in-memory token store live here.
//
// Screens keep importing from '../api' exactly as before: apiGet/apiPost/
// apiPut/apiDelete are the generic helpers with the same signatures, and the
// typed endpoint functions (login, listProducts, ...) are also exported.
import { useEffect, useState } from 'react';
import { Platform, NativeModules } from 'react-native';
import { createApiClient } from './api.generated';

// In dev, Metro serves the JS bundle from the same machine that runs the
// backend, so the API host should be the SAME host the phone used to fetch
// the bundle (works on real devices via Expo Go and in emulators), rather
// than a hardcoded localhost/10.0.2.2 which only works on one platform.
//
// Fallbacks: 10.0.2.2 = Android emulator's host loopback; localhost = iOS
// simulator / web.
//
// If the phone and the PC are NOT on the same Wi-Fi, no auto-detection can
// work — that's what the manual override below is for: the Login screen lets
// the user edit the API URL (e.g. a tunnel URL or a deployed backend) and it
// is persisted on the device, so the app always talks to the right host.
function resolveApiBaseUrl() {
  // 1. Baked-in deployed URL: EXPO_PUBLIC_* vars are inlined at bundle time
  //    by Metro, so `EXPO_PUBLIC_API_URL=https://inventrak-api.onrender.com
  //    npx expo start` makes the app talk to the DEPLOYED backend from any
  //    network (no LAN requirement, nothing to type on the phone).
  const deployed = process.env.EXPO_PUBLIC_API_URL;
  if (deployed && /^https?:\/\//i.test(deployed.trim())) {
    return deployed.trim().replace(/\/+$/, '');
  }
  try {
    // 2. Local dev: NativeModules.SourceCode.scriptURL is e.g.
    //    "http://192.168.1.50:8081/index.bundle?platform=android&..." — but in
    //    some Expo Go versions it arrives as "exp://192.168.1.50:8081/..." or
    //    "https://...". Normalize the scheme so the host regex matches all,
    //    then talk to the same machine's backend on :4001 (same Wi-Fi).
    const raw = NativeModules.SourceCode && NativeModules.SourceCode.scriptURL;
    if (typeof raw === 'string') {
      const normalized = raw.replace(/^[a-z]+:\/\//, 'http://');
      const host = normalized.match(/^https?:\/\/([^/:]+)/);
      if (host && host[1]) return `http://${host[1]}:4001`;
    }
  } catch {}
  // 3. Fallbacks: 10.0.2.2 = Android emulator's host loopback; localhost =
  //    iOS simulator / web.
  return Platform.OS === 'android' ? 'http://10.0.2.2:4001' : 'http://localhost:4001';
}

let currentBaseUrl = resolveApiBaseUrl();

// The generated client interpolates `baseUrl` into the URL template at every
// request, so passing an object whose toString() returns the CURRENT url lets
// us swap the base URL at runtime without touching generated code or re-
// exporting every endpoint.
const baseUrlHolder = {
  toString: () => currentBaseUrl,
};

// Live binding: screens importing it always see the current URL.
export let API_BASE_URL = currentBaseUrl;

export function getApiBaseUrl() {
  return currentBaseUrl;
}

// NOTE: the manual API-URL override (setApiBaseUrl / loadSavedApiUrl) was
// removed — the app always talks to the baked-in deployed URL so a stale
// saved address can never break requests.

// Product photos: the backend stores '/images/<file>' paths (or full URLs).
// Resolve to an absolute URL the <Image> component can load against the
// current API base (baked deployed URL or local dev host).
export function imageUrl(image) {
  if (!image) return null;
  return /^https?:\/\//i.test(image) ? image : currentBaseUrl + image;
}

let authToken = null;

// ---- Web-only session persistence ----
//
// A browser refresh reloads the bundle and wipes in-memory module state, so
// on web we mirror the session (token + identity) to localStorage and restore
// it at module load — refreshing the page keeps you logged in. Native stays
// in-memory on purpose: closing the app always starts guest-first
// (Shopee/Lazada-style browsing), which the team chose for the phone app.
const WEB_SESSION_KEY = 'inventrak_web_session_v1';
function isWeb() {
  return Platform.OS === 'web' && typeof window !== 'undefined' && !!window.localStorage;
}
function persistWebSession() {
  if (!isWeb()) return;
  try {
    window.localStorage.setItem(
      WEB_SESSION_KEY,
      JSON.stringify({
        token: authToken,
        username: sessionUsername,
        email: sessionEmail,
        verified: sessionVerified,
      })
    );
  } catch {}
}
function clearWebSession() {
  if (!isWeb()) return;
  try {
    window.localStorage.removeItem(WEB_SESSION_KEY);
  } catch {}
}

export function setToken(token) {
  authToken = token;
  persistWebSession();
}

export function getToken() {
  return authToken;
}

export function clearToken() {
  authToken = null;
  clearWebSession();
}

// ---- Session (guest-first browsing) ----
//
// The app opens straight into the catalog WITHOUT an account (Shopee/Lazada
// style): browse, search, recommendations — all guest-safe. The customer is
// only asked to log in / create an account when they actually BUY (place an
// order inquiry) or check order history.
//
// The username lives here in module state (plus a tiny subscription API)
// instead of being threaded through navigator route params, so every screen
// always shows the current identity — and a successful login that simply
// pops back to the tabs (preserving a filled-in inquiry form) is reflected
// everywhere instantly.
let sessionUsername = null;
let sessionEmail = null;
let sessionVerified = false;
const sessionListeners = new Set();

// Restore a persisted web session (after a browser refresh) so the customer
// stays logged in instead of bouncing back to guest browsing. Only runs on
// web; native deliberately starts fresh every launch.
if (isWeb()) {
  try {
    const raw = window.localStorage.getItem(WEB_SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.token) {
        authToken = s.token;
        sessionUsername = s.username || null;
        sessionEmail = s.email || null;
        sessionVerified = !!s.verified;
      }
    }
  } catch {}
}

export function setSessionUsername(name) {
  sessionUsername = name || null;
  persistWebSession();
  sessionListeners.forEach((fn) => fn(sessionUsername));
}

// Sets the profile fields that ride along with the session (the email the
// account was registered with, and whether it has passed verification).
// Kept separate from setSessionUsername so the guest-first flow stays intact.
export function setSessionDetails({ email, verified }) {
  sessionEmail = email || null;
  sessionVerified = !!verified;
  persistWebSession();
  sessionListeners.forEach((fn) => fn(sessionUsername));
}

export function getSessionUsername() {
  return sessionUsername;
}

export function getSessionEmail() {
  return sessionEmail;
}

export function getSessionVerified() {
  return sessionVerified;
}

export function clearSession() {
  setSessionUsername(null);
  sessionEmail = null;
  sessionVerified = false;
  clearWebSession();
}

export function subscribeSession(listener) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

// React hook: returns the logged-in username (or `fallback` while a guest).
// Re-renders the calling screen whenever login/logout changes the session.
export function useSessionUsername(fallback) {
  const [name, setName] = useState(getSessionUsername() || fallback || null);
  useEffect(
    () => subscribeSession((u) => setName(u || fallback || null)),
    [fallback]
  );
  return name;
}

// React hook: whether the logged-in account has verified its email.
export function useSessionVerified() {
  const [verified, setVerified] = useState(getSessionVerified());
  useEffect(() => subscribeSession(() => setVerified(getSessionVerified())), []);
  return verified;
}

// React hook: the email of the logged-in account (for resend/verify flows).
export function useSessionEmail() {
  const [email, setEmail] = useState(getSessionEmail());
  useEffect(() => subscribeSession(() => setEmail(getSessionEmail())), []);
  return email;
}

// Shared client instance wired to this app's base URL + token store.
const rawClient = createApiClient({ baseUrl: baseUrlHolder, getToken });

// Render's free tier sleeps after ~15 minutes idle. The first request after
// a cold start can take 30-60s while the instance boots — long enough that
// the phone's fetch gives up with "Network request failed". Two defenses:
//
//   1. wakeBackend() — fired at app launch (see App.js): a cheap GET that
//      wakes the instance early, so it is already warm by the time the
//      customer actually signs up, orders, or checks history. Fire-and-
//      forget with a couple of retries — it never blocks the UI.
//
//   2. The request wrapper below retries network-level failures (no HTTP
//      status) with short backoff — the exact cold-start signature — while
//      HTTP errors (4xx/5xx) are definitive and never retried.
const BAKED_API_URL = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');

// Cheap endpoint that answers with a small body (used only as a warm-up
// probe; the actual data calls run through the client wrapper below).
export function wakeBackend() {
  const probe = `${currentBaseUrl}/api/openapi.json`;
  const tryWake = (attempt) => {
    fetch(probe, { method: 'GET' }).catch(() => {
      // Back off: 2s, 4s, 6s — a cold boot can take longer than one attempt.
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
    // Up to 3 attempts on network-level failures with 1.5s / 3s backoff. The
    // common case: the instance was asleep, attempt 1 dies, attempts 2-3 land
    // once it is awake (identical request, so a retry is safe and correct).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await rawClient[key](...args);
      } catch (err) {
        lastErr = err;
        if (err.status) throw err; // HTTP error: definitive, no retry.
        if (attempt < 2) await sleep(1500 * (attempt + 1));
      }
    }
    // Last resort (dev only): if the request still died at the network level
    // AND a baked-in deployed URL differs from the current base, switch to
    // the baked URL and retry once — so a stale local address can never
    // permanently break the app.
    if (BAKED_API_URL && currentBaseUrl !== BAKED_API_URL) {
      currentBaseUrl = BAKED_API_URL;
      API_BASE_URL = BAKED_API_URL;
      return rawClient[key](...args);
    }
    throw lastErr;
  };
}

// Generic path-based helpers (unchanged public surface).
export const apiGet = client.apiGet;
export const apiPost = client.apiPost;
export const apiPut = client.apiPut;
export const apiDelete = client.apiDelete;

// Typed endpoints generated from the OpenAPI contract.
export const register = client.register;
export const login = client.login;
export const googleAuth = client.googleAuth;
export const getMe = client.getMe;
export const forgotPassword = client.forgotPassword;
export const resetPassword = client.resetPassword;
export const verifyEmail = client.verifyEmail;
export const resendVerification = client.resendVerification;
export const listProducts = client.listProducts;

// Fetch EVERY product across all pages (the API clamps limit to 100 per
// request, and with a 192-product catalog a single page would silently hide
// the later categories/brands — search, chips and counts must see it all).
export async function listAllProducts() {
  const all = [];
  let page = 1;
  // Safety cap: 10 pages x 100 = 1000 products, far beyond the catalog.
  while (page <= 10) {
    const data = await client.listProducts({ page, limit: 100 });
    const rows = data.data || (Array.isArray(data) ? data : []);
    all.push(...rows);
    const total = data.pagination?.total ?? all.length;
    if (all.length >= total || rows.length === 0) break;
    page += 1;
  }
  return all;
}
// Customer-facing facade: only endpoints the customer app actually uses are
// re-exported. Admin-only operations (product/location/stock management,
// sales ledger, alert resolution, user administration, reports, analytics
// export, integrity, scan-stock) live only in api.generated.js and the admin
// dashboard — the server rejects them for customers (403), so they must not
// appear in this module (a future dev importing listSales here would hit a
// 403 with no warning).
export const listCategories = client.listCategories;
export const getProduct = client.getProduct;
export const getInventory = client.getInventory;
export const listLocations = client.listLocations;
export const listStockMovements = client.listStockMovements;
export const listStockLots = client.listStockLots;
export const listOrderInquiries = client.listOrderInquiries;
export const createOrderInquiry = client.createOrderInquiry;
export const updateInquiryPayment = client.updateInquiryPayment;
export const scanProductPhoto = client.scanProductPhoto;
export const getOptimizationBulk = client.getOptimizationBulk;
export const getOptimizationAbc = client.getOptimizationAbc;
export const getOptimization = client.getOptimization;
export const getAnalyticsSummary = client.getAnalyticsSummary;

export default client;

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

// Persisted override (AsyncStorage is bundled with Expo Go). Loaded lazily via
// require() so the app still boots if the package is ever missing.
let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {}
const STORAGE_KEY = 'inventrak_api_url';

// Live binding: re-assigned by setApiBaseUrl so screens importing it (e.g.
// SignupScreen's error message) always see the current URL, not the boot value.
export let API_BASE_URL = currentBaseUrl;

export function getApiBaseUrl() {
  return currentBaseUrl;
}

// Applies + persists a manual API URL override. Returns false on invalid input.
export function setApiBaseUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) return false;
  currentBaseUrl = clean;
  API_BASE_URL = clean;
  if (AsyncStorage) {
    AsyncStorage.setItem(STORAGE_KEY, clean).catch(() => {});
  }
  return true;
}

// Restore a previously saved override (call once at app start / on Login).
export async function loadSavedApiUrl() {
  try {
    if (AsyncStorage) {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved && setApiBaseUrl(saved)) return currentBaseUrl;
    }
  } catch {}
  return currentBaseUrl;
}

let authToken = null;

export function setToken(token) {
  authToken = token;
}

export function getToken() {
  return authToken;
}

export function clearToken() {
  authToken = null;
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

export function setSessionUsername(name) {
  sessionUsername = name || null;
  sessionListeners.forEach((fn) => fn(sessionUsername));
}

// Sets the profile fields that ride along with the session (the email the
// account was registered with, and whether it has passed verification).
// Kept separate from setSessionUsername so the guest-first flow stays intact.
export function setSessionDetails({ email, verified }) {
  sessionEmail = email || null;
  sessionVerified = !!verified;
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

// Self-healing wrapper: the Login screen restores a URL saved on the device
// (loadSavedApiUrl), which is great for tunnels but can leave a STALE address
// (e.g. an old http://192.168.x.x:4001 or https://localhost:4001) that a real
// phone can never reach — "Network request failed". When a request dies at the
// network level (no HTTP status) AND the bundle has a baked-in deployed URL
// (EXPO_PUBLIC_API_URL, e.g. the Render backend) that differs from the current
// base, we switch to the baked URL and retry once. The user's manual override
// still wins for everything that succeeds.
const BAKED_API_URL = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
const client = {};
for (const key of Object.keys(rawClient)) {
  client[key] = async (...args) => {
    try {
      return await rawClient[key](...args);
    } catch (err) {
      const retryable =
        BAKED_API_URL &&
        !err.status &&
        currentBaseUrl !== BAKED_API_URL;
      if (retryable) {
        currentBaseUrl = BAKED_API_URL;
        API_BASE_URL = BAKED_API_URL;
        return rawClient[key](...args);
      }
      throw err;
    }
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
export const getMe = client.getMe;
export const forgotPassword = client.forgotPassword;
export const resetPassword = client.resetPassword;
export const verifyEmail = client.verifyEmail;
export const resendVerification = client.resendVerification;
export const listProducts = client.listProducts;
export const createProduct = client.createProduct;
export const listCategories = client.listCategories;
export const getProduct = client.getProduct;
export const updateProduct = client.updateProduct;
export const deleteProduct = client.deleteProduct;
export const getInventory = client.getInventory;
export const listLocations = client.listLocations;
export const createLocation = client.createLocation;
export const deleteLocation = client.deleteLocation;
export const createStockMovement = client.createStockMovement;
export const listStockMovements = client.listStockMovements;
export const listStockLots = client.listStockLots;
export const listOrderInquiries = client.listOrderInquiries;
export const createOrderInquiry = client.createOrderInquiry;
export const updateOrderInquiry = client.updateOrderInquiry;
export const getOptimizationBulk = client.getOptimizationBulk;
export const getOptimizationAbc = client.getOptimizationAbc;
export const getOptimization = client.getOptimization;
export const getAnalyticsSummary = client.getAnalyticsSummary;
export const exportAnalytics = client.exportAnalytics;
export const listAlerts = client.listAlerts;
export const resolveAlert = client.resolveAlert;
export const listSales = client.listSales;
export const createSale = client.createSale;
export const listUsers = client.listUsers;

export default client;

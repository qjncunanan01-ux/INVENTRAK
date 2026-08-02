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
import { Platform } from 'react-native';
import { createApiClient } from './api.generated';

export const API_BASE_URL = Platform.OS === 'android'
  ? 'http://10.0.2.2:4001'
  : 'http://localhost:4001';

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

// Shared client instance wired to this app's base URL + token store.
const client = createApiClient({ baseUrl: API_BASE_URL, getToken });

// Generic path-based helpers (unchanged public surface).
export const apiGet = client.apiGet;
export const apiPost = client.apiPost;
export const apiPut = client.apiPut;
export const apiDelete = client.apiDelete;

// Typed endpoints generated from the OpenAPI contract.
export const register = client.register;
export const login = client.login;
export const getMe = client.getMe;
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

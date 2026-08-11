 // Thin facade over the OpenAPI-generated client (api.generated.js).
//
// The generated module (regenerated from backend/openapi.json via
// `npm run client:generate`) is the single source of truth for every API
// call: it derives the full endpoint surface from the OpenAPI contract, so
// the admin dashboard always matches the documented API. Hand-written
// fetch calls are gone — only the token storage helpers live here.
//
// Pages keep importing from '../api' exactly as before:
//   - apiGet(path) / apiPost(path, body) / apiPut(path, body) / apiDelete(path)
//     are the generic helpers with the same signatures as always
//   - the named typed endpoints (login, listProducts, getInventory, ...) are
//     also exposed for call sites that want contract-checked function names
import { createApiClient } from './api.generated';

export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:4001';

// Get stored token from localStorage
export function getToken() {
  return localStorage.getItem('inventrak_token');
}
 // Set token in localStorage
export function setToken(token) {
  localStorage.setItem('inventrak_token', token);
}

// Remove token
export function clearToken() {
  localStorage.removeItem('inventrak_token');
}

// Product photos live on the API server (/images/...). Absolute URLs pass
// through untouched; relative paths are prefixed with the API base URL
// (same helper as the mobile client).
export function imageUrl(image) {
  if (!image) return null;
  return /^https?:\/\//i.test(image) ? image : API_BASE_URL + image;
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
export const forgotPassword = client.forgotPassword;
export const resetPassword = client.resetPassword;
export const listProducts = client.listProducts;
export const createProduct = client.createProduct;
export const listCategories = client.listCategories;
export const getProduct = client.getProduct;
export const updateProduct = client.updateProduct;
export const deleteProduct = client.deleteProduct;
export const bulkUpdatePrices = client.bulkUpdatePrices;
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
export const listStockAdjustments = client.listStockAdjustments;
export const createStockAdjustment = client.createStockAdjustment;
export const approveStockAdjustment = client.approveStockAdjustment;
export const rejectStockAdjustment = client.rejectStockAdjustment;
export const listStockTransfers = client.listStockTransfers;
export const createStockTransfer = client.createStockTransfer;
export const approveStockTransfer = client.approveStockTransfer;
export const rejectStockTransfer = client.rejectStockTransfer;
export const getApprovals = client.getApprovals;
export const getReports = client.getReports;
export const ocrStockCheck = client.ocrStockCheck;

export default client;

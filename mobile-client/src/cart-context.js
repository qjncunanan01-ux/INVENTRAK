import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionUsername } from './api';
import cartItems from './cart-item.cjs';

// Persistent shopping cart (Shopee/Lazada pattern). Cart entries snapshot the
// product at add-time ({ product, qty }) so the checkout never needs to refetch
// the catalog and survives offline usage.
//
// PER-ACCOUNT ISOLATION: each logged-in account gets its OWN basket, keyed by
// username (usernames are unique — deduped at account creation, including
// Google real-name accounts). Switching accounts can never mix carts: A's
// basket stays A's, B's stays B's, and a guest always sees an empty basket
// (adds are login-gated anyway).
const CART_STORAGE_PREFIX = 'inventrak_cart_v1:';
// Retired pre-per-account global key — one-time cleanup on boot.
const LEGACY_CART_STORAGE_KEY = 'inventrak_cart_v1';
const MAX_CART_LINES = 500;
const MAX_UNITS_PER_PRODUCT = process.env.EXPO_PUBLIC_SYLVER_POLICY_DEMO === 'true'
  ? Number.MAX_SAFE_INTEGER
  : 10000;

const CartContext = createContext(null);
const { addCartItem } = cartItems;

export function CartProvider({ children }) {
  const [items, setItems] = useState([]); // [{ product, qty, price?, original_price? }]
  const [hydrated, setHydrated] = useState(false);
  const itemsRef = useRef([]);
  const loadedStorageKey = useRef(null);
  // Re-renders on every login/logout (session listeners), so the basket below
  // always belongs to the account that is signed in right now.
  const owner = useSessionUsername(null);
  const storageKey = owner ? CART_STORAGE_PREFIX + owner : null;

  // Keep a synchronous snapshot for rapid taps. State updater callbacks can
  // be batched, so using only the last rendered `items` value lets repeated
  // taps race and exceed the stock/quantity checked by the screens.
  const replaceItems = useCallback((next) => {
    itemsRef.current = next;
    setItems(next);
    return next;
  }, []);

  // One-time cleanup of the retired global cart key.
  useEffect(() => {
    AsyncStorage.removeItem(LEGACY_CART_STORAGE_KEY).catch(() => {});
  }, []);

  // Load the current owner's basket whenever the owner changes (first boot
  // included). While loading, the basket is empty and persistence is paused,
  // so one account's items can never be written into another account's key.
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    replaceItems([]);
    loadedStorageKey.current = null;
    if (!storageKey) {
      // Guest: never show a basket.
      setHydrated(true);
      return undefined;
    }
    (async() => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const clean = [];
            const lineIndexById = new Map();
            for (const item of parsed) {
              const productId = Number(item && item.product && item.product.id);
              const qty = Number(item && item.qty);
              if (!Number.isInteger(productId) || productId < 1 || !Number.isInteger(qty) || qty < 1) continue;
              const existingIndex = lineIndexById.get(productId);
              if (existingIndex !== undefined) {
                clean[existingIndex] = {
                  ...clean[existingIndex],
                  qty: Math.min(MAX_UNITS_PER_PRODUCT, clean[existingIndex].qty + qty),
                };
                continue;
              }
              if (clean.length >= MAX_CART_LINES) break;
              lineIndexById.set(productId, clean.length);
              clean.push({ ...item, qty: Math.min(qty, MAX_UNITS_PER_PRODUCT) });
            }
            replaceItems(clean);
          }
        }
      } catch {
        // corrupt/absent cart — start empty
      }
      if (!cancelled) {
        loadedStorageKey.current = storageKey;
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, replaceItems]);

  // Persist on every change, but only after the current owner's basket loaded.
  useEffect(() => {
    // On account switches, effects still see the prior render's `items` once.
    // Persist only after this exact account's basket has finished loading.
    if (!hydrated || !storageKey || loadedStorageKey.current !== storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(items)).catch(() => {});
  }, [items, hydrated, storageKey]);

  // Adds a product or increments its quantity (qty is clamped to >= 1).
  // `price` optionally overrides the unit price snapshot (e.g. the day's flash
  // DEAL price for a pick, so the cart + checkout total match what the
  // carousel/PDP advertised). Falls back to the catalog price when omitted.
  // `originalPrice` snapshots the pre-discount catalog price for deal items,
  // so the order record can show the discount applied (deal vs original).
  const addItem = useCallback((product, qty = 1, price, originalPrice, available) => {
    if (!hydrated || !storageKey) return false;
    const next = addCartItem({
      previous: itemsRef.current,
      product,
      qty,
      price,
      originalPrice,
      available,
      maxUnits: MAX_UNITS_PER_PRODUCT,
      maxLines: MAX_CART_LINES,
    });
    if (!next) return false;
    replaceItems(next);
    return true;
  }, [hydrated, storageKey, replaceItems]);

  // Sets an exact quantity; 0 removes the line (stepper minus at qty 1).
  const setQty = useCallback((productId, qty) => {
    const id = Number(productId);
    if (!Number.isInteger(id) || id < 1) return;
    const q = Math.min(MAX_UNITS_PER_PRODUCT, Math.max(0, Math.floor(Number(qty) || 0)));
    const previous = itemsRef.current;
    const next = q === 0
      ? previous.filter((i) => Number(i.product.id) !== id)
      : previous.map((i) => (Number(i.product.id) === id ? { ...i, qty: q } : i));
    if (next !== previous) replaceItems(next);
  }, [replaceItems]);

  const removeItem = useCallback((productId) => {
    const id = Number(productId);
    replaceItems(itemsRef.current.filter((i) => Number(i.product.id) !== id));
  }, [replaceItems]);

  const clear = useCallback(() => replaceItems([]), [replaceItems]);

  const value = useMemo(() => {
    const itemCount = items.length;
    const count = items.reduce((s, i) => s + i.qty, 0);
    // Unit price: the deal snapshot when the item was added as a flash pick,
    // else the catalog price (legacy persisted carts have no `price` field).
    const unitPrice = (i) => (Number(i.price) > 0 ? Number(i.price) : Number(i.product.price) || 0);
    const subtotal = items.reduce((s, i) => s + unitPrice(i) * i.qty, 0);
    return { items, itemCount, count, subtotal, hydrated, addItem, setQty, removeItem, clear };
  }, [items, hydrated, addItem, setQty, removeItem, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSessionUsername } from './api';

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

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState([]); // [{ product, qty, price?, original_price? }]
  const [hydrated, setHydrated] = useState(false);
  // Re-renders on every login/logout (session listeners), so the basket below
  // always belongs to the account that is signed in right now.
  const owner = useSessionUsername(null);
  const storageKey = owner ? CART_STORAGE_PREFIX + owner : null;

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
    setItems([]);
    if (!storageKey) {
      // Guest: never show a basket.
      setHydrated(true);
      return undefined;
    }
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const clean = parsed.filter(
              (i) => i && i.product && i.product.id != null && Number(i.qty) > 0
            );
            setItems(clean);
          }
        }
      } catch {
        // corrupt/absent cart — start empty
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Persist on every change, but only after the current owner's basket loaded.
  useEffect(() => {
    if (!hydrated || !storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(items)).catch(() => {});
  }, [items, hydrated, storageKey]);

  // Adds a product or increments its quantity (qty is clamped to >= 1).
  // `price` optionally overrides the unit price snapshot (e.g. the day's flash
  // DEAL price for a pick, so the cart + checkout total match what the
  // carousel/PDP advertised). Falls back to the catalog price when omitted.
  // `originalPrice` snapshots the pre-discount catalog price for deal items,
  // so the order record can show the discount applied (deal vs original).
  const addItem = useCallback((product, qty = 1, price, originalPrice) => {
    const q = Math.max(1, Math.floor(Number(qty) || 1));
    const unit = Number(price) > 0 ? Number(price) : Number(product.price) || 0;
    const original = Number(originalPrice) > 0 ? Number(originalPrice) : null;
    setItems((prev) => {
      const existing = prev.find((i) => Number(i.product.id) === Number(product.id));
      if (existing) {
        return prev.map((i) =>
          Number(i.product.id) === Number(product.id)
            ? { ...i, qty: i.qty + q, price: i.price ?? unit, original_price: i.original_price ?? original }
            : i
        );
      }
      return [...prev, { product, qty: q, price: unit, original_price: original }];
    });
  }, []);

  // Sets an exact quantity; 0 removes the line (stepper minus at qty 1).
  const setQty = useCallback((productId, qty) => {
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    setItems((prev) => {
      if (q === 0) return prev.filter((i) => Number(i.product.id) !== Number(productId));
      return prev.map((i) => (Number(i.product.id) === Number(productId) ? { ...i, qty: q } : i));
    });
  }, []);

  const removeItem = useCallback((productId) => {
    setItems((prev) => prev.filter((i) => Number(i.product.id) !== Number(productId)));
  }, []);

  const clear = useCallback(() => setItems([]), []);

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

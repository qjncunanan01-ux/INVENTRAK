import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getToken } from './api';

// Persistent shopping cart (Shopee/Lazada pattern). Cart entries snapshot the
// product at add-time ({ product, qty }) so the checkout never needs to refetch
// the catalog and survives offline usage. Persisted to AsyncStorage so a
// reload/restart does not lose the basket.
const CART_STORAGE_KEY = 'inventrak_cart_v1';

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState([]); // [{ product, qty }]
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once on boot (before any write so the first save doesn't wipe it).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CART_STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            // Merge instead of replace: an item added before hydration
            // finished (e.g. Buy Now from the PDP right after boot) must not
            // be silently overwritten by the older stored snapshot.
            setItems((prev) => {
              const clean = parsed.filter(
                (i) => i && i.product && i.product.id != null && Number(i.qty) > 0
              );
              const storedIds = new Set(clean.map((i) => Number(i.product.id)));
              return [...clean, ...prev.filter((i) => !storedIds.has(Number(i.product.id)))];
            });
          }
        }
      } catch {
        // corrupt/absent cart — start empty
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist on every change, but only after the initial hydration completes.
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items)).catch(() => {});
  }, [items, hydrated]);

  // Guests must never see a cart: the basket is member-only (every add is
  // login-gated), so when there is no authenticated session the persisted cart
  // is stale — either left over from a PREVIOUS user's session (survived a
  // fresh app launch, since the session/token never persists across restarts)
  // or from a logout that didn't fully clear. Wipe it whenever the token is
  // absent, so the tab badge can never show leftover items to a guest.
  const token = getToken();
  useEffect(() => {
    if (!hydrated) return;
    if (!token) setItems([]);
  }, [hydrated, token]);

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

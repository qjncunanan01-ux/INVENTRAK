// Shared in-process fake Firestore for driver and migration tests. Implements
// the subset of the Firestore SDK the store driver uses (collection/orderBy/
// get/listDocuments/doc/batch).
//
// It is deliberately STRICTER than a naive stub in one way: `set()` throws on
// null / undefined / non-finite-number field values, exactly like the real
// Firestore SDK. That makes the fake a canary — the store driver's null→''
// sanitization is verified by these tests instead of silently failing against
// the real cloud.
'use strict';

function validateDoc(v, where) {
  if (v === null) {
    throw new Error(`Firestore set(): null field at ${where} — the driver must sanitize nulls`);
  }
  if (v === undefined) {
    throw new Error(`Firestore set(): undefined field at ${where}`);
  }
  if (typeof v === 'number' && !Number.isFinite(v)) {
    throw new Error(`Firestore set(): non-finite number at ${where}`);
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => validateDoc(x, `${where}[${i}]`));
    return v;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) validateDoc(x, `${where}.${k}`);
    return v;
  }
  return v;
}

function makeFakeDb() {
  const cols = new Map(); // name -> Map(docId, data)
  const db = {
    _cols: cols,
    collection(name) {
      if (!cols.has(name)) cols.set(name, new Map());
      const map = cols.get(name);
      const docs = () =>
        [...map.entries()].map(([id, data]) => ({ id, data: () => ({ ...data }) }));
      return {
        orderBy() {
          return this;
        },
        async get() {
          const list = docs().sort(
            (a, b) => (a.data().__idx ?? -1e9) - (b.data().__idx ?? -1e9)
          );
          return { forEach: (fn) => list.forEach(fn), docs: list };
        },
        async listDocuments() {
          return [...map.keys()].map((id) => ({ id, path: `${name}/${id}` }));
        },
        doc(id) {
          return { id, path: `${name}/${id}` };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, data) {
          validateDoc(data, ref.path);
          ops.push(['set', ref.path, JSON.parse(JSON.stringify(data))]);
        },
        delete(ref) {
          ops.push(['del', ref.path]);
        },
        async commit() {
          for (const [kind, p, data] of ops) {
            const [cn, id] = p.split('/');
            if (!cols.has(cn)) cols.set(cn, new Map());
            const m = cols.get(cn);
            if (kind === 'set') m.set(id, data);
            else m.delete(id);
          }
        },
      };
    },
  };
  return db;
}

module.exports = { makeFakeDb, validateDoc };

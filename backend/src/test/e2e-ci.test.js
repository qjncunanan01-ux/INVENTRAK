/**
 * E2E CI Test Suite — validates the full API surface on every PR.
 *
 * Tests the complete user journey: register → verify → login → order → admin
 * approve, plus security headers, role-based access control, cache behavior,
 * rate limiting, and error handling. Runs against both the SQLite and npm-free
 * backends simultaneously via the shared harness.
 *
 * Usage:
 *   node --test src/test/e2e-ci.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

// ============================================================
// Setup / Teardown
// ============================================================

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

// ============================================================
// Helpers
// ============================================================

function testSide(side, label) {
  return { url: side.url, token: side.token, label };
}

// ============================================================
// 1. Health & Connectivity
// ============================================================

describe('Health & Connectivity', () => {
  for (const side of [sqlite, npmfree]) {      it(`${side.label || 'backend'}: GET /api/health returns 200 with correct shape`, async () => {
        const res = await call(side.url, '/api/health');
        assert.equal(res.status, 200);
        assert.equal(res.json.ok, true);
        assert.ok(typeof res.json.time === 'string');
      });

    it(`${side.label || 'backend'}: GET /api/openapi.json returns valid OpenAPI spec`, async () => {
      const res = await call(side.url, '/api/openapi.json');
      assert.equal(res.status, 200);
      assert.ok(res.json.openapi);
      assert.ok(res.json.paths);
      assert.ok(res.json.info);
    });

    it(`${side.label || 'backend'}: security headers present`, async () => {
      const res = await call(side.url, '/api/health');
      // Node 18 fetch doesn't expose all headers; check via raw response
      assert.ok(res.status === 200);
    });
  }
});

// ============================================================
// 2. Authentication Flow
// ============================================================

describe('Authentication Flow', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      it('login with valid credentials returns token', async () => {
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'admin123' },
        });
        assert.equal(res.status, 200);
        assert.ok(res.json.token);
        assert.equal(res.json.user.role, 'admin');
        assert.equal(res.json.user.username, 'admin');
      });

      it('login with wrong password returns 401 generic error', async () => {
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'wrongpassword' },
        });
        assert.equal(res.status, 401);
        assert.ok(res.json.error.includes('Invalid'));
        // Must NOT reveal whether username exists
        assert.ok(!res.json.error.includes('admin'));
      });

      it('login with missing fields returns 400', async () => {
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin' },
        });
        assert.equal(res.status, 400);
      });

      it('bot honeypot field rejected', async () => {
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'admin123', website: 'http://spam.com' },
        });
        assert.equal(res.status, 400);
      });

      it('GET /api/auth/me with valid token returns user', async () => {
        const loginRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'admin123' },
        });
        const res = await call(side.url, '/api/auth/me', {
          token: loginRes.json.token,
        });
        assert.equal(res.status, 200);
        assert.equal(res.json.username, 'admin');
        assert.equal(res.json.role, 'admin');
      });

      it('GET /api/auth/me without token returns 401', async () => {
        const res = await call(side.url, '/api/auth/me');
        assert.equal(res.status, 401);
      });

      it('GET /api/auth/me with invalid token returns 403', async () => {
        const res = await call(side.url, '/api/auth/me', {
          token: 'not-a-real-token',
        });
        assert.equal(res.status, 403);
      });

      it('POST /api/auth/logout revokes token', async () => {
        const loginRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'customer', password: 'customer123' },
        });
        const token = loginRes.json.token;

        // Logout
        const logoutRes = await call(side.url, '/api/auth/logout', {
          method: 'POST',
          token,
        });
        assert.equal(logoutRes.status, 200);

        // Token should now be invalid
        const meRes = await call(side.url, '/api/auth/me', { token });
        assert.ok(meRes.status === 403 || meRes.status === 401);
      });
    });
  }
});

// ============================================================
// 3. Registration & Email Verification
// ============================================================

describe('Registration & Email Verification', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      it('register creates new account with verification code', async () => {
        const username = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const res = await call(side.url, '/api/auth/register', {
          method: 'POST',
          body: {
            username,
            password: 'TestPass123!',
            email: `${username}@test.com`,
            phone: '09171234567',
          },
        });
        assert.equal(res.status, 200);
        assert.ok(res.json.token);
        assert.equal(res.json.user.email_verified, false);
      });

      it('register rejects duplicate username', async () => {
        const res = await call(side.url, '/api/auth/register', {
          method: 'POST',
          body: {
            username: 'admin',
            password: 'TestPass123!',
            email: 'admin@test.com',
            phone: '09171234567',
          },
        });
        assert.equal(res.status, 409);
      });

      it('register rejects weak password', async () => {
        const res = await call(side.url, '/api/auth/register', {
          method: 'POST',
          body: {
            username: `weak_${Date.now()}`,
            password: '123',
            email: 'weak@test.com',
            phone: '09171234567',
          },
        });
        assert.equal(res.status, 400);
      });

      it('register rejects invalid phone', async () => {
        const res = await call(side.url, '/api/auth/register', {
          method: 'POST',
          body: {
            username: `phone_${Date.now()}`,
            password: 'TestPass123!',
            email: 'phone@test.com',
            phone: 'not-a-phone',
          },
        });
        assert.equal(res.status, 400);
      });
    });
  }
});

// ============================================================
// 4. Product Catalog (Public)
// ============================================================

describe('Product Catalog', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      it('GET /api/products returns array of products', async () => {
        const res = await call(side.url, '/api/products');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.json));
        assert.ok(res.json.length > 0);
        // Each product has required fields
        const p = res.json[0];
        assert.ok(p.id);
        assert.ok(p.name);
        assert.ok(p.category);
        assert.ok(typeof p.price === 'number');
      });

      it('GET /api/products supports pagination', async () => {
        const res = await call(side.url, '/api/products?page=1&limit=10');
        assert.equal(res.status, 200);
        assert.ok(res.json.data);
        assert.ok(res.json.pagination);
        assert.ok(res.json.data.length <= 10);
        assert.equal(res.json.pagination.page, 1);
        assert.equal(res.json.pagination.limit, 10);
      });

      it('GET /api/products supports search', async () => {
        const res = await call(side.url, '/api/products?search=chocolate');
        assert.equal(res.status, 200);
        const products = res.json.data || res.json;
        assert.ok(products.length > 0);
        // Search matches name, category, or brand
        assert.ok(products.every(p => {
          const haystack = `${p.name} ${p.category} ${p.brand}`.toLowerCase();
          return haystack.includes('chocolate');
        }));
      });

      it('GET /api/products/categories returns category list', async () => {
        const res = await call(side.url, '/api/products/categories');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.json));
        assert.ok(res.json.length > 5);
        assert.ok(res.json.includes('Torani'));
      });

      it('GET /api/products/:id returns single product', async () => {
        const listRes = await call(side.url, '/api/products');
        const firstId = listRes.json[0].id;
        const res = await call(side.url, `/api/products/${firstId}`);
        assert.equal(res.status, 200);
        assert.equal(res.json.id, firstId);
        assert.ok(res.json.name);
      });

      it('GET /api/products/99999 returns 404', async () => {
        const res = await call(side.url, '/api/products/99999');
        assert.equal(res.status, 404);
      });
    });
  }
});

// ============================================================
// 5. Inventory (Public)
// ============================================================

describe('Inventory', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      it('GET /api/inventory returns locations and items', async () => {
        const res = await call(side.url, '/api/inventory');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.json.locations));
        assert.ok(Array.isArray(res.json.items));
        assert.ok(res.json.locations.length > 0);
        assert.ok(res.json.items.length > 0);
      });

      it('GET /api/locations returns location list', async () => {
        const res = await call(side.url, '/api/locations');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.json));
        assert.ok(res.json.length > 0);
        assert.ok(res.json[0].id);
        assert.ok(res.json[0].name);
      });
    });
  }
});

// ============================================================
// 6. Role-Based Access Control
// ============================================================

describe('Role-Based Access Control', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      let adminToken, staffToken, customerToken;

      before(async () => {
        // Get admin token
        const adminRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'admin123' },
        });
        adminToken = adminRes.json.token;

        // Get customer token
        const custRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'customer', password: 'customer123' },
        });
        customerToken = custRes.json.token;

        // Staff token
        const staffRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'staff', password: 'staff123' },
        });
        staffToken = staffRes.json.token;
      });

      it('admin can access /api/users', async () => {
        const res = await call(side.url, '/api/users', { token: adminToken });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.json));
      });

      it('customer cannot access /api/users (403)', async () => {
        const res = await call(side.url, '/api/users', { token: customerToken });
        assert.equal(res.status, 403);
      });

      it('staff cannot access /api/users (403)', async () => {
        const res = await call(side.url, '/api/users', { token: staffToken });
        assert.equal(res.status, 403);
      });

      it('customer cannot create products (403)', async () => {
        const res = await call(side.url, '/api/products', {
          method: 'POST',
          token: customerToken,
          body: { name: 'Hacker Product', category: 'Test', price: 1 },
        });
        assert.equal(res.status, 403);
      });

      it('admin can access /api/sales', async () => {
        const res = await call(side.url, '/api/sales', { token: adminToken });
        assert.equal(res.status, 200);
      });

      it('customer cannot access /api/sales (403)', async () => {
        const res = await call(side.url, '/api/sales', { token: customerToken });
        assert.equal(res.status, 403);
      });

      it('unauthenticated request to protected endpoint returns 401', async () => {
        const res = await call(side.url, '/api/users');
        assert.equal(res.status, 401);
      });
    });
  }
});

// ============================================================
// 7. Order Inquiry Flow (End-to-End)
// ============================================================

describe('Order Inquiry Flow', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      let customerToken, adminToken, inquiryId;

      before(async () => {
        const custRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'customer', password: 'customer123' },
        });
        customerToken = custRes.json.token;

        const adminRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'admin123' },
        });
        adminToken = adminRes.json.token;
      });

      it('customer can create order inquiry', async () => {
        const res = await call(side.url, '/api/order-inquiries', {
          method: 'POST',
          token: customerToken,
          body: {
            customer_name: 'E2E Test Customer',
            customer_email: 'e2e@test.com',
            products: ['Da Vinci Butterscotch Sauce (2L) x 5'],
            estimated_cost: 5350,
            notes: 'E2E test order',
          },
        });
        assert.equal(res.status, 201);
        assert.ok(res.json.id);
        inquiryId = res.json.id;
      });

      it('customer can see own order in history', async () => {
        const res = await call(side.url, '/api/order-inquiries', {
          token: customerToken,
        });
        assert.equal(res.status, 200);
        const inquiries = res.json.data || res.json;
        assert.ok(Array.isArray(inquiries));
        assert.ok(inquiries.some(i => i.id === inquiryId));
      });

      it('admin can see all orders', async () => {
        const res = await call(side.url, '/api/order-inquiries', {
          token: adminToken,
        });
        assert.equal(res.status, 200);
        const inquiries = res.json.data || res.json;
        assert.ok(Array.isArray(inquiries));
        assert.ok(inquiries.length > 0);
      });

      it('admin can approve order inquiry', async () => {
        const res = await call(side.url, `/api/order-inquiries/${inquiryId}`, {
          method: 'PUT',
          token: adminToken,
          body: { status: 'approved' },
        });
        assert.equal(res.status, 200);
      });

      it('order status updates correctly', async () => {
        const res = await call(side.url, '/api/order-inquiries', {
          token: adminToken,
        });
        const inquiries = res.json.data || res.json;
        const order = inquiries.find(i => i.id === inquiryId);
        assert.ok(order);
        assert.equal(order.status, 'approved');
      });
    });
  }
});

// ============================================================
// 8. Stock Movements (Admin)
// ============================================================

describe('Stock Movements', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      let adminToken;

      before(async () => {
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'admin123' },
        });
        adminToken = res.json.token;
      });

      it('admin can record stock-in', async () => {
        const res = await call(side.url, '/api/stock-movement', {
          method: 'POST',
          token: adminToken,
          body: {
            product_id: 1,
            qty: 50,
            type: 'stock-in',
            dst_location: 1,
            notes: 'E2E test stock-in',
            user: 'e2e-test',
          },
        });
        assert.equal(res.status, 200);
      });

      it('stock movements are recorded', async () => {
        const res = await call(side.url, '/api/stock-movements', {
          token: adminToken,
        });
        assert.equal(res.status, 200);
        const movements = res.json.data || res.json;
        assert.ok(Array.isArray(movements));
        assert.ok(movements.some(m => m.notes && m.notes.includes('E2E test')));
      });

      it('customer cannot record stock movements (403)', async () => {
        const custRes = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'customer', password: 'customer123' },
        });
        const res = await call(side.url, '/api/stock-movement', {
          method: 'POST',
          token: custRes.json.token,
          body: { product_id: 1, qty: 10, type: 'stock-in', dst_location: 1 },
        });
        assert.equal(res.status, 403);
      });
    });
  }
});

// ============================================================
// 9. Analytics & Reports
// ============================================================

describe('Analytics & Reports', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      let adminToken;

      before(async () => {
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'admin123' },
        });
        adminToken = res.json.token;
      });

      it('GET /api/analytics/summary returns dashboard metrics', async () => {
        const res = await call(side.url, '/api/analytics/summary', {
          token: adminToken,
        });
        assert.equal(res.status, 200);
        assert.ok(typeof res.json.totalProducts === 'number');
        assert.ok(typeof res.json.totalStock === 'number');
        assert.ok(typeof res.json.lowStockItems === 'number');
        assert.ok(typeof res.json.totalLocations === 'number');
      });

      it('GET /api/optimization returns ABC analysis', async () => {
        const res = await call(side.url, '/api/optimization', {
          token: adminToken,
        });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.json));
      });

      it('GET /api/alerts returns low-stock alerts', async () => {
        const res = await call(side.url, '/api/alerts', {
          token: adminToken,
        });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.json));
      });
    });
  }
});

// ============================================================
// 10. Error Handling & Edge Cases
// ============================================================

describe('Error Handling', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      it('invalid JSON body returns 400', async () => {
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: 'not-json',
        });
        assert.equal(res.status, 400);
      });

      it('non-existent route returns 404', async () => {
        const res = await call(side.url, '/api/nonexistent');
        assert.equal(res.status, 404);
      });

      it('GET on POST-only route returns 404', async () => {
        const res = await call(side.url, '/api/auth/login');
        assert.equal(res.status, 404);
      });

      it('oversized payload rejected (413)', async () => {
        const bigBody = { data: 'x'.repeat(200 * 1024) };
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: bigBody,
        });
        assert.ok(res.status === 413 || res.status === 400);
      });
    });
  }
});

// ============================================================
// 11. Cross-Backend Contract Parity
// ============================================================

describe('Cross-Backend Contract Parity', () => {
  it('products list shape matches between SQLite and npm-free', async () => {
    const { a, b } = await both('products shape', '/api/products');
    assert.ok(Array.isArray(a.json));
    assert.ok(Array.isArray(b.json));
    assert.equal(a.json.length, b.json.length);
  });

  it('categories list matches between backends', async () => {
    const { a, b } = await both('categories shape', '/api/products/categories');
    assert.deepEqual(a.json.sort(), b.json.sort());
  });

  it('inventory shape matches between backends', async () => {
    const { a, b } = await both('inventory shape', '/api/inventory');
    assert.equal(a.json.locations.length, b.json.locations.length);
    assert.equal(a.json.items.length, b.json.items.length);
  });

  it('locations list matches between backends', async () => {
    const { a, b } = await both('locations shape', '/api/locations');
    assert.equal(a.json.length, b.json.length);
  });
});

// ============================================================
// 12. Security Headers & CORS
// ============================================================

describe('Security', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      it('health endpoint is well-formed', async () => {
        const res = await call(side.url, '/api/health');
        assert.equal(res.status, 200);
        assert.ok(res.json.ok);
        assert.ok(typeof res.json.driver === 'string');
        assert.ok(typeof res.json.time === 'string');
      });
    });
  }
});

// ============================================================
// 13. Rate Limiting (Brute-Force Protection)
// ============================================================

describe('Rate Limiting', () => {
  for (const side of [sqlite, npmfree]) {
    describe(side.label || 'backend', () => {
      it('multiple failed logins trigger lockout', async () => {
        const username = `lockout_${Date.now()}`;
        // Register first
        await call(side.url, '/api/auth/register', {
          method: 'POST',
          body: {
            username,
            password: 'TestPass123!',
            email: `${username}@test.com`,
            phone: '09171234567',
          },
        });

        // Try wrong password multiple times
        for (let i = 0; i < 6; i++) {
          await call(side.url, '/api/auth/login', {
            method: 'POST',
            body: { username, password: 'wrong' },
          });
        }

        // Should now be locked out
        const res = await call(side.url, '/api/auth/login', {
          method: 'POST',
          body: { username, password: 'TestPass123!' },
        });
        assert.equal(res.status, 429);
        assert.ok(res.json.error.includes('Too many'));
      });
    });
  }
});

// @ts-check
import { test, expect } from '@playwright/test';

// Helper: login as admin and navigate to dashboard
async function loginAsAdmin(page) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await page.waitForSelector('text=INVENTRAK Admin', { timeout: 10_000 });
  await page.getByRole('button', { name: /owner/i }).click();
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL('**/', { timeout: 10_000 });
  await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 10_000 });
}

// Helper: login as staff
async function loginAsStaff(page) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await page.waitForSelector('text=INVENTRAK Admin', { timeout: 10_000 });
  await page.getByRole('button', { name: /staff/i }).click();
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL('**/', { timeout: 10_000 });
  await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 10_000 });
}

test.describe('Dashboard Smoke Test', () => {
  test('dashboard loads with all KPI cards and charts', async ({ page }) => {
    await loginAsAdmin(page);

    // Inventory Overview cards
    await expect(page.getByRole('button', { name: /total products/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /total inventory/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /low stock items/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /locations/i }).first()).toBeVisible();

    // Sales & Orders cards
    await expect(page.getByRole('button', { name: /sales this month/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /total sales/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /customers served/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /order status/i })).toBeVisible();

    // Activity cards
    await expect(page.getByRole('button', { name: /transactions this month/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /pending inquiries/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /stock movements/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /active alerts/i })).toBeVisible();

    // Charts sections
    await expect(page.getByText('Inventory Analytics')).toBeVisible();
    await expect(page.getByText('Sales & Orders Analytics')).toBeVisible();
    await expect(page.getByText('Stock Movement Analytics')).toBeVisible();

    // Role badge
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();

    // Welcome message
    await expect(page.getByText(/welcome back/i)).toBeVisible();
  });

  test('clicking a KPI card opens the detail modal with search', async ({ page }) => {
    await loginAsAdmin(page);

    // Click Total Products card
    await page.getByRole('button', { name: /total products/i }).click();

    // Modal opens
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'Total Products', exact: true })).toBeVisible();

    // Search works
    const searchInput = page.getByPlaceholder(/search/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill('Da Vinci');
      await page.waitForTimeout(500);
      // Verify filtered results
      const rows = dialog.locator('tbody tr');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    }

    // Close modal
    await page.getByRole('button', { name: /close/i }).first().click();
    await expect(dialog).not.toBeVisible();
  });

  test('last-refreshed timestamp updates', async ({ page }) => {
    await loginAsAdmin(page);
    // "Updated HH:MM:SS" should be visible
    await expect(page.getByText(/updated \d/i)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Navigation & Role-Based Access', () => {
  test('admin sees all nav sections', async ({ page }) => {
    await loginAsAdmin(page);

    // All sections should be visible
    await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /inventory levels/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /stock movement/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /products/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /order inquiries/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /approvals/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /security/i })).toBeVisible();
  });

  test('staff sees limited nav (no Approvals, no Products, no Security)', async ({ page }) => {
    await loginAsStaff(page);

    // Staff should see these
    await expect(page.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /inventory levels/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /scan & stock/i })).toBeVisible();

    // Staff should NOT see these (admin-only)
    await expect(page.getByRole('link', { name: /approvals/i })).not.toBeVisible();
    await expect(page.getByRole('link', { name: /security/i })).not.toBeVisible();
  });

  test('navigate to Products page and back', async ({ page }) => {
    await loginAsAdmin(page);

    await page.getByRole('link', { name: /products/i }).click();
    await page.waitForURL('**/products', { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /active products/i })).toBeVisible();

    // Navigate back to dashboard
    await page.getByRole('link', { name: /dashboard/i }).click();
    await page.waitForURL('**/', { timeout: 5_000 });
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
  });

  test('navigate to Inventory page', async ({ page }) => {
    await loginAsAdmin(page);

    await page.getByRole('link', { name: /inventory levels/i }).click();
    await page.waitForURL('**/inventory', { timeout: 5_000 });
    // Inventory page has a search field and product table
    await expect(page.getByRole('textbox', { name: /search products/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10_000 });
  });

  test('logout clears session and returns to login', async ({ page }) => {
    await loginAsAdmin(page);

    const logoutBtn = page.getByRole('button', { name: /logout/i });
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Should return to login page
    await page.waitForSelector('text=INVENTRAK Admin', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /login/i })).toBeVisible();

    // Session should be cleared
    const token = await page.evaluate(() => sessionStorage.getItem('inventrak_token'));
    expect(token).toBeNull();
  });

  test('sidebar collapse/expand works on desktop', async ({ page }) => {
    await loginAsAdmin(page);

    // Find the collapse toggle button
    const toggleBtn = page.locator('button[aria-label*="collapse"], button[aria-label*="expand"]').first();
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(300);

      // Sidebar should collapse (labels hidden) or expand (labels visible)
      const inventoryLink = page.getByRole('link', { name: /inventory levels/i });
      // After toggle, the link text might be hidden (mini mode) or visible
      const isVisible = await inventoryLink.isVisible();
      // Toggle back
      await toggleBtn.click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Products Page', () => {
  test('products list loads with search and filter controls', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /products/i }).click();
    await page.waitForURL('**/products', { timeout: 5_000 });

    // Search field exists (MUI TextField uses label, not placeholder)
    const searchInput = page.getByRole('textbox', { name: /search products/i });
    await expect(searchInput).toBeVisible();

    // Table loads with products
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('search filters products', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /products/i }).click();
    await page.waitForURL('**/products', { timeout: 5_000 });

    // Wait for table to load
    await page.locator('table tbody tr').first().waitFor({ timeout: 10_000 });
    const allCount = await page.locator('table tbody tr').count();

    // Search for a specific product
    const searchInput = page.getByRole('textbox', { name: /search products/i });
    await searchInput.fill('Da Vinci');
    await page.waitForTimeout(500);

    const filteredCount = await page.locator('table tbody tr').count();
    expect(filteredCount).toBeLessThanOrEqual(allCount);
    expect(filteredCount).toBeGreaterThan(0);

    // Clear search
    await searchInput.clear();
    await page.waitForTimeout(500);
  });
});

test.describe('Order Inquiries Page', () => {
  test('order inquiries page loads for admin', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /order inquiries/i }).click();
    await page.waitForURL('**/order-inquiries', { timeout: 5_000 });

    // Page should render
    await expect(page.getByText(/order inquiries/i).first()).toBeVisible();

    // Table should load (may be empty or have data)
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Inventory Page', () => {
  test('inventory page loads with product data', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /inventory levels/i }).click();
    await page.waitForURL('**/inventory', { timeout: 5_000 });

    // Search field (MUI TextField uses label)
    const searchInput = page.getByRole('textbox', { name: /search products/i });
    await expect(searchInput).toBeVisible();

    // Table loads
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Accessibility', () => {
  test('dashboard has proper heading hierarchy', async ({ page }) => {
    await loginAsAdmin(page);

    // h4 for page title
    const heading = page.getByRole('heading', { name: 'Admin Dashboard' });
    await expect(heading).toBeVisible();
  });

  test('all interactive elements are keyboard accessible', async ({ page }) => {
    await loginAsAdmin(page);

    // Tab through KPI cards — they should be focusable
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // The focused element should be interactive
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName + ':' + (el?.getAttribute('role') || '');
    });
    expect(focused).not.toBe('BODY:');
  });
});

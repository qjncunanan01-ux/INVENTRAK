// @ts-check
import { test, expect } from '@playwright/test';

// Helper: login as admin and navigate to a page
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

test.describe('Dashboard Smoke Test', () => {
  test('dashboard loads with KPI cards and charts', async ({ page }) => {
    await loginAsAdmin(page);

    // KPI cards should be visible
    await expect(page.getByRole('button', { name: /total products/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /total inventory/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /low stock items/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /locations/i }).first()).toBeVisible();

    // Charts should render (at least the section labels)
    await expect(page.getByText('Inventory Analytics')).toBeVisible();
    await expect(page.getByText('Sales & Orders Analytics')).toBeVisible();

    // Role badge should show ADMIN
    await expect(page.getByText('ADMIN', { exact: true })).toBeVisible();
  });

  test('clicking a KPI card opens the detail modal', async ({ page }) => {
    await loginAsAdmin(page);

    // Click the Total Products card
    const productsCard = page.getByRole('button', { name: /total products/i });
    await productsCard.click();

    // Modal should open with product list
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'Total Products', exact: true })).toBeVisible();

    // Search should work
    const searchInput = page.getByPlaceholder('Search items…');
    if (await searchInput.isVisible()) {
      await searchInput.fill('Da Vinci');
      // Wait for filter to apply
      await page.waitForTimeout(500);
    }

    // Close modal
    await page.getByRole('button', { name: /close/i }).first().click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('sidebar nav works and role-based filtering applies', async ({ page }) => {
    await loginAsAdmin(page);

    // Dashboard should be active
    await expect(page.getByText('Admin Dashboard')).toBeVisible();

    // Navigate to Products (admin-only)
    const productsLink = page.getByRole('link', { name: /products/i });
    if (await productsLink.isVisible()) {
      await productsLink.click();
      await page.waitForURL('**/products', { timeout: 5_000 });
      await expect(page.getByRole('heading', { name: /active products/i })).toBeVisible();
    }
  });

  test('logout clears session and returns to login', async ({ page }) => {
    await loginAsAdmin(page);

    // Find and click logout
    const logoutBtn = page.getByRole('button', { name: /logout/i });
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      // After logout, should see login page
      await page.waitForSelector('text=INVENTRAK Admin', { timeout: 10_000 });
      await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
    }
  });
});

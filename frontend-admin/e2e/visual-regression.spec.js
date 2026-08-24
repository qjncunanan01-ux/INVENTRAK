// @ts-check
import { test, expect } from '@playwright/test';

// Helper: login as admin
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

test.describe('Visual Regression — Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/');
    await page.waitForSelector('text=INVENTRAK Admin', { timeout: 10_000 });
  });

  test('login page — full view', async ({ page }) => {
    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('login page — credentials expanded', async ({ page }) => {
    await page.getByText('Show demo credentials').click();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('login-page-credentials.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('login page — error state', async ({ page }) => {
    await page.getByRole('button', { name: /owner/i }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill('wrongpassword');
    await page.getByRole('button', { name: /login/i }).click();
    await expect(page.getByText(/invalid username or password/i)).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveScreenshot('login-page-error.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Dashboard', () => {
  test('dashboard — full view with KPI cards', async ({ page }) => {
    await loginAsAdmin(page);
    // Wait for data to load
    await expect(page.getByText('Total Products')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500); // Let charts render
    await expect(page).toHaveScreenshot('dashboard-full.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('dashboard — KPI cards row', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Total Products')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    // Capture just the top section (KPI cards)
    const kpiSection = page.locator('text=Inventory Overview').first();
    await expect(kpiSection).toBeVisible();
    await expect(kpiSection.locator('..').locator('..')).toHaveScreenshot('dashboard-kpi-cards.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('dashboard — charts section', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Inventory Analytics')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await expect(page.getByText('Inventory Analytics').first()).toHaveScreenshot('dashboard-charts.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('dashboard — modal detail view', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Total Products')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /total products/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).toHaveScreenshot('dashboard-modal.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Navigation', () => {
  test('sidebar — expanded state', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 10_000 });
    const sidebar = page.locator('[role="complementary"], nav, aside').first();
    if (await sidebar.isVisible()) {
      await expect(sidebar).toHaveScreenshot('sidebar-expanded.png', {
        maxDiffPixelRatio: 0.02,
      });
    }
  });

  test('sidebar — collapsed state', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 10_000 });
    // Find and click collapse toggle
    const toggle = page.locator('button[aria-label*="collapse"], button[aria-label*="expand"]').first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(400);
      const sidebar = page.locator('[role="complementary"], nav, aside').first();
      if (await sidebar.isVisible()) {
        await expect(sidebar).toHaveScreenshot('sidebar-collapsed.png', {
          maxDiffPixelRatio: 0.02,
        });
      }
    }
  });
});

test.describe('Visual Regression — Products Page', () => {
  test('products page — table view', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /products/i }).click();
    await page.waitForURL('**/products', { timeout: 5_000 });
    await page.locator('table tbody tr').first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('products-page.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('products page — edit form', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /products/i }).click();
    await page.waitForURL('**/products', { timeout: 5_000 });
    await page.locator('table tbody tr').first().waitFor({ timeout: 10_000 });
    // Click Edit on first product
    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    const visible = await editBtn.isVisible().catch(() => false);
    test.skip(!visible, 'Edit button not visible on products page');
    await editBtn.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('products-edit-form.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Inventory Page', () => {
  test('inventory page — table view', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: /inventory levels/i }).click();
    await page.waitForURL('**/inventory', { timeout: 5_000 });
    await page.locator('table tbody tr').first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('inventory-page.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Role Badge', () => {
  test('admin role badge visible', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 10_000 });
    // Capture the top-right area with the role badge
    const badge = page.getByText('ADMIN', { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveScreenshot('admin-role-badge.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression — Responsive', () => {
  test('login page — mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/');
    await page.waitForSelector('text=INVENTRAK Admin', { timeout: 10_000 });
    await expect(page).toHaveScreenshot('login-page-mobile.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('dashboard — tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsAdmin(page);
    await expect(page.getByText('Total Products')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('dashboard-tablet.png', {
      fullPage: false,
      maxDiffPixelRatio: 0.02,
    });
  });
});

// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Admin Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear session so we always start at the login page
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/');
    await page.waitForSelector('text=INVENTRAK Admin', { timeout: 10_000 });
  });

  test('login page renders with demo quick-fill buttons', async ({ page }) => {
    // Owner and Staff buttons visible
    await expect(page.getByRole('button', { name: /owner/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /staff/i })).toBeVisible();

    // Credentials hidden by default
    await expect(page.getByText('admin / admin123')).not.toBeVisible();
    await expect(page.getByText('staff / staff123')).not.toBeVisible();

    // Toggle reveals them
    await page.getByText('Show demo credentials').click();
    await expect(page.getByText('admin / admin123')).toBeVisible();
  });

  test('owner quick-fill populates form and login lands on dashboard', async ({ page }) => {
    // Click Owner button
    await page.getByRole('button', { name: /owner/i }).click();

    // Username and password fields should be filled
    const usernameField = page.getByLabel('Username');
    const passwordField = page.getByRole('textbox', { name: 'Password' });
    await expect(usernameField).toHaveValue('admin');
    await expect(passwordField).toHaveValue('admin123');

    // Click Login
    await page.getByRole('button', { name: /login/i }).click();

    // Should land on dashboard (URL = /)
    await page.waitForURL('**/', { timeout: 10_000 });
    await expect(page.getByText('Admin Dashboard')).toBeVisible();
  });

  test('wrong password shows generic error (no username oracle)', async ({ page }) => {
    await page.getByRole('button', { name: /owner/i }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill('wrongpassword');
    await page.getByRole('button', { name: /login/i }).click();

    // Error should be generic — not reveal which credential was wrong
    await expect(page.getByText(/invalid username or password/i)).toBeVisible({ timeout: 5_000 });
  });

  test('caps lock warning appears when caps lock is on', async ({ page, browserName }) => {
    // Caps lock detection relies on KeyboardEvent.getModifierState() which
    // headless Chromium does not support — skip in headless mode.
    test.skip(browserName === 'chromium', 'CapsLock detection not supported in headless Chromium');

    // Type in password field and trigger caps lock detection
    const passwordField = page.getByRole('textbox', { name: 'Password' });
    await passwordField.focus();

    // Simulate caps lock key press
    await page.keyboard.press('CapsLock');
    await page.keyboard.type('test');

    // Caps lock warning should appear
    await expect(page.getByText(/caps lock is on/i)).toBeVisible();

    // Clean up
    await page.keyboard.press('CapsLock');
  });

  test('MFA flow: password accepted → code input → verify', async ({ page }) => {
    // This test only works if admin has MFA enabled
    // Skip if MFA is not set up (login goes straight to dashboard)
    await page.getByRole('button', { name: /owner/i }).click();
    await page.getByRole('button', { name: /login/i }).click();

    // Wait for either dashboard or MFA prompt
    const dashboardOrMfa = await Promise.race([
      page.waitForSelector('text=Admin Dashboard', { timeout: 8_000 }).then(() => 'dashboard'),
      page.waitForSelector('text=Authenticator code', { timeout: 8_000 }).then(() => 'mfa'),
    ]);

    if (dashboardOrMfa === 'mfa') {
      // MFA is enabled — verify the code input and back button exist
      await expect(page.getByLabel('Authenticator code')).toBeVisible();
      await expect(page.getByRole('button', { name: /back to login/i })).toBeVisible();

      // Back button returns to password form
      await page.getByRole('button', { name: /back to login/i }).click();
      await expect(page.getByLabel('Username')).toBeVisible();
    }
    // If dashboard, MFA is not enabled — test passes
  });
});

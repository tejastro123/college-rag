import { test, expect } from '@playwright/test'

test.describe('CollegeRAG E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('shows login page when unauthenticated', async ({ page }) => {
    await expect(page.locator('h1, h2').first()).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('can navigate to register page', async ({ page }) => {
    await page.getByText(/register|sign up/i).first().click()
    await expect(page).toHaveURL(/\/register/)
  })

  test('shows validation errors on empty login', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /login|sign in/i }).first().click()
    await expect(page.locator('text=required')).toBeVisible()
  })

  test.describe('authenticated', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login')
      await page.fill('input[type="email"], input[name="email"]', 'test@example.com')
      await page.fill('input[type="password"]', 'TestPass123!')
      await page.getByRole('button', { name: /login|sign in/i }).first().click()
    })

    test('redirects to chat on login', async ({ page }) => {
      await expect(page).toHaveURL(/\/chat/)
    })

    test('sidebar is visible', async ({ page }) => {
      await expect(page.locator('.sidebar, .chat-sidebar').first()).toBeVisible()
    })

    test('can navigate to documents', async ({ page }) => {
      await page.getByText(/documents/i).first().click()
      await expect(page).toHaveURL(/\/documents/)
    })

    test('can navigate to courses', async ({ page }) => {
      await page.getByText(/courses/i).first().click()
      await expect(page).toHaveURL(/\/courses/)
    })

    test('can navigate to study tools', async ({ page }) => {
      await page.getByText(/study/i).first().click()
      await expect(page).toHaveURL(/\/study/)
    })

    test('search bar accepts input', async ({ page }) => {
      await page.fill('input[placeholder*="Search"]', 'test document')
      await page.waitForTimeout(400)
      const results = page.locator('text=No results found')
      await expect(results).toBeVisible()
    })

    test('theme toggle works', async ({ page }) => {
      const html = page.locator('html')
      const initial = await html.getAttribute('data-theme')
      await page.getByTitle(/switch to/i).first().click()
      const toggled = await html.getAttribute('data-theme')
      expect(toggled).not.toBe(initial)
    })
  })
})

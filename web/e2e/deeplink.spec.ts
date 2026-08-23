import { test, expect } from '@playwright/test'

test('deep link /datapack-editor opens the editor and survives reload', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/datapack-editor', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60000 })
})

test('404 stash key is restored by the app', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('minex-datapack-checker-redirect', '/datapack-editor')
  })
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60000 })
})

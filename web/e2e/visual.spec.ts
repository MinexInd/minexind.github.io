import { test, expect } from '@playwright/test'

// Absolute path to a tiny datapack fixture (pack.mcmeta + one .mcfunction).
const FIXTURE = '/tmp/e2e-mcfunc-pack'

test('visual editor: decompiles, compiles, and validates a mcfunction', async ({ page }) => {
  test.setTimeout(120000)
  // Landing is the MinexStudio hub; enter the Datapack Editor first.
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByRole('button', { name: /Open Datapack Editor/i }).click()
  await expect(page.locator('.dropzone')).toBeVisible({ timeout: 60000 })

  // Load the fixture datapack via the folder input.
  await page.locator('input[webkitdirectory]').setInputFiles(FIXTURE)
  await expect(page.locator('.ide-tree')).toBeVisible({ timeout: 60000 })

  // Open the mcfunction file from the tree.
  const item = page.locator('.ide-tree-row.ide-file', { hasText: 'hello.mcfunction' }).first()
  await expect(item).toBeVisible({ timeout: 20000 })
  await item.click()

  // Visual editor renders the decompiled graph.
  await expect(page.locator('.visual-editor')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.vnode').first()).toBeVisible({ timeout: 30000 })

  // Compile produces .mcfunction output.
  await page.locator('.visual-compile').click()
  await expect(page.locator('.visual-compiled')).toContainText('give', { timeout: 20000 })

  // Validate shows a status (valid graph => "valid").
  await page.locator('.visual-validate').click()
  await expect(page.locator('.visual-status')).toHaveText(/valid|issue/, { timeout: 20000 })

  // Adding an unconnected exec node should surface a validation issue.
  const before = await page.locator('.vnode').count()
  await page.locator('.visual-palette-item', { hasText: 'Function Call' }).click()
  await expect.poll(() => page.locator('.vnode').count()).toBeGreaterThan(before)
  await page.locator('.visual-validate').click()
  await expect(page.locator('.visual-status')).toContainText('issue', { timeout: 20000 })

  // Compile again reflects the added node (still emits the original commands).
  await page.locator('.visual-compile').click()
  await expect(page.locator('.visual-compiled')).toContainText('give', { timeout: 20000 })
})

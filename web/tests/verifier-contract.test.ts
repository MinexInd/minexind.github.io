import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { ContextMenu } from '../src/components/ContextMenu'
import IdePage from '../src/components/IdePage'
import { buildResourceIndex as rootBuildResourceIndex } from '../../src/analyzer'
import { buildResourceIndex as webBuildResourceIndex } from '../src/engine/analyzer'
import { restructurePath as rootRestructurePath, getRegistryForPath as rootGetRegistryForPath } from '../../src/fixer'
import { restructurePath as webRestructurePath, getRegistryForPath as webGetRegistryForPath } from '../src/engine/fixer'

function stubProps(overrides: Record<string, unknown> = {}) {
  const noop = () => {}
  const base: Record<string, unknown> = {
    originalFiles: {
      'pack.mcmeta': '{"pack":{"pack_format":48,"description":"t"}}',
      'data/test/functions/main.mcfunction': 'say hi',
    },
    editedFiles: {},
    onEditedFilesChange: noop,
    deletedFiles: new Set<string>(),
    onDeletedFilesChange: noop,
    revision: 1,
    fileCount: 2,
    fileName: 'pack',
    onLoad: noop,
    onClear: noop,
    onBack: noop,
    mode: 'auto',
    onModeChange: noop,
    all: false,
    onAllChange: noop,
    strict: false,
    onStrictChange: noop,
    versions: [],
    versionsLoading: false,
    selectedVersions: [],
    onSelectedVersionsChange: noop,
    loading: false,
    error: '',
    progress: '',
    result: null,
    resultStale: false,
    checkDuration: 0,
    onRun: noop,
    onPortTo: noop,
    fixTarget: '',
    onFixTargetChange: noop,
    fixSource: '',
    onFixSourceChange: noop,
    fixPreview: null,
    previewStale: false,
    onPreview: noop,
    onDownload: noop,
  }
  return { ...base, ...overrides } as any
}

describe('Verifier Contract: Bug 1 - ContextMenu Overlay Guard', () => {
  it('renders null and produces empty HTML when items is empty', () => {
    const html = renderToString(
      createElement(ContextMenu, {
        x: 0,
        y: 0,
        onClose: () => {},
        onAction: () => {},
        items: [],
      })
    )
    expect(html).toBe('')
    expect(html).not.toContain('min-w-[180px]')
  })

  it('renders null when items is null or undefined', () => {
    const html = renderToString(
      createElement(ContextMenu, {
        x: 0,
        y: 0,
        onClose: () => {},
        onAction: () => {},
        items: null as any,
      })
    )
    expect(html).toBe('')
  })

  it('ContextMenu does not leak into IdePage when closed / not triggered', () => {
    const html = renderToString(createElement(IdePage, stubProps()))
    // The context menu container has class 'min-w-[180px]'
    expect(html).not.toContain('min-w-[180px]')
  })

  it('renders menu items properly when items are present', () => {
    const html = renderToString(
      createElement(ContextMenu, {
        x: 10,
        y: 20,
        onClose: () => {},
        onAction: () => {},
        items: [{ label: 'Rename', action: 'rename', shortcut: 'F2' }],
      })
    )
    expect(html).toContain('Rename')
    expect(html).toContain('F2')
    expect(html).toContain('context-menu')
  })
})

describe('Verifier Contract: Bug 2 - Analysis Engine Directory Detection', () => {
  const singularPack = {
    'data/test_ns/function/sub/tick.mcfunction': 'say hello',
    'data/test_ns/loot_table/chests/loot.json': '{}',
    'data/test_ns/recipe/diamond_sword.json': '{}',
    'data/test_ns/advancement/first.json': '{}',
    'data/test_ns/predicate/is_sneaking.json': '{}',
    'data/test_ns/item_modifier/give_lore.json': '{}',
    'data/test_ns/tags/function/load.json': '{"values":[]}',
    'data/test_ns/tags/item/swords.json': '{"values":[]}',
    'data/test_ns/tags/block/stone.json': '{"values":[]}',
    'data/test_ns/tags/entity_type/skeletons.json': '{"values":[]}',
  }

  it('root analyzer indexes all 1.21+ singular resources correctly on disk', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'analyzer-contract-'))
    try {
      for (const [relPath, content] of Object.entries(singularPack)) {
        const full = join(tmpDir, relPath)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, content)
      }
      const res = rootBuildResourceIndex(tmpDir)
      const find = (type: string, name: string) =>
        res.find(r => r.type === type && r.name === name && r.namespace === 'test_ns')

      expect(find('function', 'sub/tick')).toBeDefined()
      expect(find('loot_table', 'chests/loot')).toBeDefined()
      expect(find('recipe', 'diamond_sword')).toBeDefined()
      expect(find('advancement', 'first')).toBeDefined()
      expect(find('predicate', 'is_sneaking')).toBeDefined()
      expect(find('item_modifier', 'give_lore')).toBeDefined()
      expect(find('tag/function', 'load')).toBeDefined()
      expect(find('tag/item', 'swords')).toBeDefined()
      expect(find('tag/block', 'stone')).toBeDefined()
      expect(find('tag/entity_type', 'skeletons')).toBeDefined()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('web analyzer indexes all 1.21+ singular resources correctly', () => {
    const res = webBuildResourceIndex(singularPack)
    const find = (type: string, name: string) =>
      res.find(r => r.type === type && r.name === name && r.namespace === 'test_ns')

    expect(find('function', 'sub/tick')).toBeDefined()
    expect(find('loot_table', 'chests/loot')).toBeDefined()
    expect(find('recipe', 'diamond_sword')).toBeDefined()
    expect(find('advancement', 'first')).toBeDefined()
    expect(find('predicate', 'is_sneaking')).toBeDefined()
    expect(find('item_modifier', 'give_lore')).toBeDefined()
    expect(find('tag/function', 'load')).toBeDefined()
    expect(find('tag/item', 'swords')).toBeDefined()
    expect(find('tag/block', 'stone')).toBeDefined()
    expect(find('tag/entity_type', 'skeletons')).toBeDefined()
  })
})

describe('Verifier Contract: Bug 2 - Fixer 1.21 Directory Restructuring', () => {
  it('root and web fixer correctly port directories forward from 1.20 to 1.21', () => {
    const testCases: [string, string][] = [
      ['data/demo/functions/main.mcfunction', 'data/demo/function/main.mcfunction'],
      ['data/demo/loot_tables/chest.json', 'data/demo/loot_table/chest.json'],
      ['data/demo/recipes/recipe.json', 'data/demo/recipe/recipe.json'],
      ['data/demo/advancements/adv.json', 'data/demo/advancement/adv.json'],
      ['data/demo/predicates/pred.json', 'data/demo/predicate/pred.json'],
      ['data/demo/item_modifiers/mod.json', 'data/demo/item_modifier/mod.json'],
      ['data/demo/structures/tower.nbt', 'data/demo/structure/tower.nbt'],
      ['data/demo/tags/functions/tick.json', 'data/demo/tags/function/tick.json'],
      ['data/demo/tags/blocks/stone.json', 'data/demo/tags/block/stone.json'],
      ['data/demo/tags/items/tools.json', 'data/demo/tags/item/tools.json'],
      ['data/demo/tags/entity_types/mob.json', 'data/demo/tags/entity_type/mob.json'],
      ['data/demo/tags/game_events/step.json', 'data/demo/tags/game_event/step.json'],
    ]

    for (const [before, after] of testCases) {
      expect(rootRestructurePath(before, '1.20.4', '1.21')).toBe(after)
      expect(webRestructurePath(before, '1.20.4', '1.21')).toBe(after)
    }
  })

  it('root and web fixer correctly port directories backward from 1.21 to 1.20', () => {
    const testCases: [string, string][] = [
      ['data/demo/function/main.mcfunction', 'data/demo/functions/main.mcfunction'],
      ['data/demo/loot_table/chest.json', 'data/demo/loot_tables/chest.json'],
      ['data/demo/recipe/recipe.json', 'data/demo/recipes/recipe.json'],
      ['data/demo/advancement/adv.json', 'data/demo/advancements/adv.json'],
      ['data/demo/predicate/pred.json', 'data/demo/predicates/pred.json'],
      ['data/demo/item_modifier/mod.json', 'data/demo/item_modifiers/mod.json'],
      ['data/demo/structure/tower.nbt', 'data/demo/structures/tower.nbt'],
      ['data/demo/tags/function/tick.json', 'data/demo/tags/functions/tick.json'],
      ['data/demo/tags/block/stone.json', 'data/demo/tags/blocks/stone.json'],
      ['data/demo/tags/item/tools.json', 'data/demo/tags/items/tools.json'],
      ['data/demo/tags/entity_type/mob.json', 'data/demo/tags/entity_types/mob.json'],
      ['data/demo/tags/game_event/step.json', 'data/demo/tags/game_events/step.json'],
    ]

    for (const [before, after] of testCases) {
      expect(rootRestructurePath(before, '1.21', '1.20.4')).toBe(after)
      expect(webRestructurePath(before, '1.21', '1.20.4')).toBe(after)
    }
  })

  it('root and web getRegistryForPath recognize singular and plural forms', () => {
    expect(rootGetRegistryForPath('data/x/functions/a.mcfunction')).toBe('functions')
    expect(rootGetRegistryForPath('data/x/function/a.mcfunction')).toBe('function')
    expect(webGetRegistryForPath('data/x/functions/a.mcfunction')).toBe('functions')
    expect(webGetRegistryForPath('data/x/function/a.mcfunction')).toBe('function')
  })
})

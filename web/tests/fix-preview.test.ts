import { describe, it, expect, vi } from 'vitest'
import { toFixPreviewV2, type FixPreviewLike, type FixPreviewV2 } from '../../src/fix-preview'
import { applyFixPreview } from '../../src/fix-apply'
import { computeLineDiff } from '../src/ide/fix-diff'
import { getRegistryForPath, getRegistrySkipReason, restructurePath, fixDatapack, fixResourcePack } from '../src/engine/fixer'

vi.mock('../src/engine/api', () => ({
  fetchVersions: vi.fn(async () => [
    { id: '1.20.4', name: '1.20.4', type: 'release', stable: true, data_pack_version: 41, resource_pack_version: 34, data_version: 3826 },
    { id: '1.20.5', name: '1.20.5', type: 'release', stable: true, data_pack_version: 61, resource_pack_version: 40, data_version: 3955 },
    { id: '1.21', name: '1.21', type: 'release', stable: true, data_pack_version: 68, resource_pack_version: 45, data_version: 4525 },
    { id: '1.21.4', name: '1.21.4', type: 'release', stable: true, data_pack_version: 71, resource_pack_version: 47, data_version: 4620 },
  ]),
}))

vi.mock('../src/engine/mcdoc-check', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/engine/mcdoc-check')>()
  return { ...actual, getMcdocSymbols: vi.fn(async () => null) }
})

describe('toFixPreviewV2', () => {
  it('maps legacy FixPreview to FixPreviewV2 with before/after, reason, confidence, and skipped files', () => {
    const files: Record<string, string> = {
      'pack.mcmeta': '{\n  "pack": {\n    "pack_format": 15\n  }\n}',
      'data/demo/functions/main.mcfunction': 'execute if entity @s run say hello\nexecute if score @s obj matches 1.. run say test',
      'data/demo/predicates/test.json': '{\n  "condition": "minecraft:entity_properties"\n}',
    }

    const legacyPreview: FixPreviewLike = {
      results: [
        {
          file: 'pack.mcmeta',
          patches: 1,
          details: ['Updated pack_format to 61 for 1.21.4'],
        },
        {
          file: 'data/demo/functions/main.mcfunction',
          patches: 1,
          details: ['main.mcfunction:2: execute command syntax updated'],
        },
        {
          file: 'data/demo/predicates/test.json',
          patches: 1,
          details: ['Predicate field rename for 1.21.4'],
        },
      ],
      plan: {
        sourceVersion: '1.20.2',
        targetVersion: '1.21.4',
        direction: 'forward',
        rewrites: [
          {
            id: 'execute-syntax',
            description: 'Execute command syntax updated',
            count: 1,
            files: ['data/demo/functions/main.mcfunction'],
          },
        ],
        jsonFixes: [
          {
            type: 'predicate_field_rename',
            count: 1,
            files: ['data/demo/predicates/test.json'],
          },
        ],
        manualAttention: [],
        skippedFiles: [
          {
            file: 'data/demo/dialog/intro.json',
            registry: 'dialog',
            reason: 'Dialog registry not supported in target version',
          },
        ],
        summary: {
          totalFilesToPatch: 3,
          commandRewrites: 1,
          jsonFixes: 1,
          manualAttention: 0,
          skippedFiles: 1,
          mcdocRemovals: 0,
          packMcmetaUpdate: true,
        },
      },
      summary: {
        filesFixed: 3,
        totalPatches: 3,
        errors: [],
      },
      outputFiles: {
        'pack.mcmeta': '{\n  "pack": {\n    "pack_format": 61\n  }\n}',
        'data/demo/functions/main.mcfunction': 'execute if entity @s run say hello\nexecute if score @s obj matches 1.. run say updated',
        'data/demo/predicates/test.json': '{\n  "condition": "minecraft:entity_properties_renamed"\n}',
      },
    }

    const v2 = toFixPreviewV2(legacyPreview, files)

    expect(v2.version).toBe('1.21.4')
    expect(v2.summary).toContain('3 files changed')
    expect(v2.summary).toContain('1.21.4')

    // Check skipped files
    expect(v2.skipped).toHaveLength(1)
    expect(v2.skipped[0].file).toBe('data/demo/dialog/intro.json')
    expect(v2.skipped[0].reason).toContain('Dialog registry not supported')

    // Find each file change
    const mcmetaChange = v2.changes.find(c => c.file === 'pack.mcmeta')
    expect(mcmetaChange).toBeDefined()
    expect(mcmetaChange?.before).toBe(files['pack.mcmeta'])
    expect(mcmetaChange?.after).toBe(legacyPreview.outputFiles!['pack.mcmeta'])
    expect(mcmetaChange?.confidence).toBe('high')
    expect(mcmetaChange?.reason).toContain('pack_format')

    const mcfunctionChange = v2.changes.find(c => c.file === 'data/demo/functions/main.mcfunction')
    expect(mcfunctionChange).toBeDefined()
    expect(mcfunctionChange?.before).toBe(files['data/demo/functions/main.mcfunction'])
    expect(mcfunctionChange?.after).toBe(legacyPreview.outputFiles!['data/demo/functions/main.mcfunction'])
    expect(mcfunctionChange?.confidence).toBe('medium')
    expect(mcfunctionChange?.reason).toContain('execute command syntax updated')

    const predicateChange = v2.changes.find(c => c.file === 'data/demo/predicates/test.json')
    expect(predicateChange).toBeDefined()
    expect(predicateChange?.confidence).toBe('high')
    expect(predicateChange?.reason).toContain('Predicate field rename')

    const skippedChange = v2.changes.find(c => c.file === 'data/demo/dialog/intro.json')
    expect(skippedChange).toBeDefined()
    expect(skippedChange?.skipped).toBe(true)
  })

  it('assigns low confidence when manual attention or warnings are flagged', () => {
    const files: Record<string, string> = {
      'data/demo/functions/complex.mcfunction': 'execute ... complex macro ...',
    }

    const preview: FixPreviewLike = {
      results: [
        {
          file: 'data/demo/functions/complex.mcfunction',
          patches: 1,
          details: ['Manual attention: complex macro requires human verification'],
        },
      ],
      plan: {
        sourceVersion: '1.20',
        targetVersion: '1.21',
        direction: 'forward',
        rewrites: [],
        jsonFixes: [],
        manualAttention: [
          {
            description: 'Macro verification',
            reason: 'Complex macro requires manual check',
            files: ['data/demo/functions/complex.mcfunction'],
          },
        ],
        summary: {
          totalFilesToPatch: 1,
          commandRewrites: 0,
          jsonFixes: 0,
          manualAttention: 1,
          mcdocRemovals: 0,
          packMcmetaUpdate: false,
        },
      },
      outputFiles: {
        'data/demo/functions/complex.mcfunction': 'execute ... ported macro ...',
      },
    }

    const v2 = toFixPreviewV2(preview, files)
    const change = v2.changes.find(c => c.file === 'data/demo/functions/complex.mcfunction')
    expect(change?.confidence).toBe('low')
    expect(change?.reason.toLowerCase()).toContain('complex macro')
  })

  it('handles empty or missing fix preview gracefully', () => {
    const v2 = toFixPreviewV2(null, {})
    expect(v2.changes).toEqual([])
    expect(v2.skipped).toEqual([])
    expect(v2.summary).toBe('No fix preview available')
  })
})

describe('applyFixPreview and rollback/undo', () => {
  it('applies changed files and returns a backup of ONLY changed files', () => {
    const originalWorkspace: Record<string, string> = {
      'pack.mcmeta': '{"pack_format": 15}',
      'data/a.mcfunction': '# a original',
      'data/b.mcfunction': '# b unchanged',
      'data/c.json': '{"field": 1}',
    }

    const previewV2: FixPreviewV2 = {
      version: '1.21.4',
      summary: '2 files changed',
      skipped: [{ file: 'data/skipped.json', reason: 'unsupported' }],
      changes: [
        {
          file: 'pack.mcmeta',
          before: '{"pack_format": 15}',
          after: '{"pack_format": 61}',
          reason: 'Format bump',
          confidence: 'high',
        },
        {
          file: 'data/a.mcfunction',
          before: '# a original',
          after: '# a updated',
          reason: 'Command fix',
          confidence: 'medium',
        },
        {
          file: 'data/b.mcfunction',
          before: '# b unchanged',
          after: '# b unchanged',
          reason: 'No change',
          confidence: 'high',
        },
        {
          file: 'data/skipped.json',
          before: '{"skip": true}',
          after: '{"skip": false}',
          reason: 'Skipped file',
          confidence: 'low',
          skipped: true,
          skipReason: 'unsupported',
        },
      ],
    }

    const applied = applyFixPreview(previewV2, originalWorkspace)

    // Applied files should reflect updates for changed, unskipped files
    expect(applied.files['pack.mcmeta']).toBe('{"pack_format": 61}')
    expect(applied.files['data/a.mcfunction']).toBe('# a updated')
    expect(applied.files['data/b.mcfunction']).toBe('# b unchanged')
    expect(applied.files['data/c.json']).toBe('{"field": 1}')
    // Skipped file was not modified
    expect(applied.files['data/skipped.json']).toBeUndefined()

    // Backup should contain ONLY the files that actually changed
    expect(Object.keys(applied.backup).sort()).toEqual(['data/a.mcfunction', 'pack.mcmeta'])
    expect(applied.backup['pack.mcmeta']).toBe('{"pack_format": 15}')
    expect(applied.backup['data/a.mcfunction']).toBe('# a original')
    expect('data/b.mcfunction' in applied.backup).toBe(false)
    expect('data/c.json' in applied.backup).toBe(false)
    expect('data/skipped.json' in applied.backup).toBe(false)

    // Rollback: overlaying backup over applied files restores the exact original workspace
    const restoredWorkspace = { ...applied.files, ...applied.backup }
    expect(restoredWorkspace).toEqual(originalWorkspace)
  })
})

describe('computeLineDiff', () => {
  it('computes line-level additions, deletions, and context rows', () => {
    const before = 'line 1\nline 2\nline 3'
    const after = 'line 1\nline 2 modified\nline 3'

    const diff = computeLineDiff(before, after)
    expect(diff.additions).toBe(1)
    expect(diff.deletions).toBe(1)
    expect(diff.rows.some(r => r.kind === 'removed' && r.text === 'line 2')).toBe(true)
    expect(diff.rows.some(r => r.kind === 'added' && r.text === 'line 2 modified')).toBe(true)
  })

  it('returns zero additions and deletions for identical content', () => {
    const content = 'same line 1\nsame line 2'
    const diff = computeLineDiff(content, content)
    expect(diff.additions).toBe(0)
    expect(diff.deletions).toBe(0)
    expect(diff.rows).toHaveLength(0)
  })
})

describe('getRegistryForPath and directory detection in web fixer', () => {
  it('recognizes both singular (1.21+) and plural (<1.21) directories', () => {
    expect(getRegistryForPath('data/minecraft/functions/tick.mcfunction')).toBe('functions')
    expect(getRegistryForPath('data/minecraft/function/tick.mcfunction')).toBe('function')
    expect(getRegistryForPath('data/minecraft/loot_tables/chests/simple.json')).toBe('loot_tables')
    expect(getRegistryForPath('data/minecraft/loot_table/chests/simple.json')).toBe('loot_table')
    expect(getRegistryForPath('data/minecraft/recipes/craft.json')).toBe('recipes')
    expect(getRegistryForPath('data/minecraft/recipe/craft.json')).toBe('recipe')
    expect(getRegistryForPath('data/minecraft/advancements/story/root.json')).toBe('advancements')
    expect(getRegistryForPath('data/minecraft/advancement/story/root.json')).toBe('advancement')
    expect(getRegistryForPath('data/minecraft/predicates/test.json')).toBe('predicates')
    expect(getRegistryForPath('data/minecraft/predicate/test.json')).toBe('predicate')
    expect(getRegistryForPath('data/minecraft/item_modifiers/test.json')).toBe('item_modifiers')
    expect(getRegistryForPath('data/minecraft/item_modifier/test.json')).toBe('item_modifier')
    expect(getRegistryForPath('data/minecraft/structures/tower.nbt')).toBe('structures')
    expect(getRegistryForPath('data/minecraft/structure/tower.nbt')).toBe('structure')
    expect(getRegistryForPath('data/minecraft/tags/function/tick.json')).toBe('tags/function')
    expect(getRegistryForPath('data/minecraft/tags/functions/tick.json')).toBe('tags/functions')
  })

  it('checks registry skip reasons across singular and plural names', () => {
    expect(getRegistrySkipReason('data/demo/predicates/test.json', '1.14')).not.toBeNull()
    expect(getRegistrySkipReason('data/demo/predicate/test.json', '1.14')).not.toBeNull()
    expect(getRegistrySkipReason('data/demo/predicate/test.json', '1.20')).toBeNull()
  })
})

describe('restructurePath in web fixer', () => {
  it('correctly maps plural to singular when porting forward across 1.21', () => {
    expect(restructurePath('data/demo/functions/main.mcfunction', '1.20.4', '1.21.4')).toBe('data/demo/function/main.mcfunction')
    expect(restructurePath('data/demo/loot_tables/chest.json', '1.20.4', '1.21.4')).toBe('data/demo/loot_table/chest.json')
    expect(restructurePath('data/demo/recipes/recipe.json', '1.20.4', '1.21.4')).toBe('data/demo/recipe/recipe.json')
    expect(restructurePath('data/demo/advancements/adv.json', '1.20.4', '1.21.4')).toBe('data/demo/advancement/adv.json')
    expect(restructurePath('data/demo/predicates/pred.json', '1.20.4', '1.21.4')).toBe('data/demo/predicate/pred.json')
    expect(restructurePath('data/demo/item_modifiers/mod.json', '1.20.4', '1.21.4')).toBe('data/demo/item_modifier/mod.json')
  })

  it('correctly maps singular to plural when porting backward across 1.21', () => {
    expect(restructurePath('data/demo/function/main.mcfunction', '1.21.4', '1.20.4')).toBe('data/demo/functions/main.mcfunction')
    expect(restructurePath('data/demo/loot_table/chest.json', '1.21.4', '1.20.4')).toBe('data/demo/loot_tables/chest.json')
    expect(restructurePath('data/demo/recipe/recipe.json', '1.21.4', '1.20.4')).toBe('data/demo/recipes/recipe.json')
    expect(restructurePath('data/demo/advancement/adv.json', '1.21.4', '1.20.4')).toBe('data/demo/advancements/adv.json')
    expect(restructurePath('data/demo/predicate/pred.json', '1.21.4', '1.20.4')).toBe('data/demo/predicates/pred.json')
    expect(restructurePath('data/demo/item_modifier/mod.json', '1.21.4', '1.20.4')).toBe('data/demo/item_modifiers/mod.json')
  })
})

describe('fixDatapack and fixResourcePack directory restructuring and safety', () => {
  it('restructures plural files to singular and preserves all pack files without corruption', async () => {
    const files: Record<string, string> = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 41, description: 'test' } }),
      'data/demo/functions/main.mcfunction': 'say hello\n',
      'data/demo/loot_tables/chest.json': '{"pools":[]}\n',
      'data/demo/structures/tower.nbt': 'BINARY_DATA',
      'pack.png': 'PNG_DATA',
    }

    const { files: output, results, summary, plan } = await fixDatapack({
      files,
      targetVersion: '1.21.4',
    })

    expect(summary.errors).toEqual([])
    expect(plan.direction).toBe('forward')

    // Plural directories restructured to singular
    expect('data/demo/function/main.mcfunction' in output).toBe(true)
    expect('data/demo/functions/main.mcfunction' in output).toBe(false)
    expect(output['data/demo/function/main.mcfunction']).toBe('say hello\n')

    expect('data/demo/loot_table/chest.json' in output).toBe(true)
    expect('data/demo/loot_tables/chest.json' in output).toBe(false)

    // Non-JSON / non-mcfunction files in data/ preserved and restructured
    expect('data/demo/structure/tower.nbt' in output).toBe(true)
    expect(output['data/demo/structure/tower.nbt']).toBe('BINARY_DATA')

    // Root files preserved
    expect(output['pack.png']).toBe('PNG_DATA')

    // pack.mcmeta format updated
    const pm = JSON.parse(output['pack.mcmeta'])
    expect(pm.pack.pack_format).toBe(71)
  })

  it('restructures singular files to plural on backport', async () => {
    const files: Record<string, string> = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 71, description: '1.21.4 pack' } }),
      'data/demo/function/main.mcfunction': 'say hello\n',
      'data/demo/loot_table/chest.json': '{"pools":[]}\n',
    }

    const { files: output, summary, plan } = await fixDatapack({
      files,
      targetVersion: '1.20.4',
    })

    expect(summary.errors).toEqual([])
    expect(plan.direction).toBe('backward')

    expect('data/demo/functions/main.mcfunction' in output).toBe(true)
    expect('data/demo/function/main.mcfunction' in output).toBe(false)
    expect('data/demo/loot_tables/chest.json' in output).toBe(true)
    expect('data/demo/loot_table/chest.json' in output).toBe(false)
  })

  it('fixResourcePack generates accurate plan and updates pack format', async () => {
    const files: Record<string, string> = {
      'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: 'rp' } }),
      'assets/demo/models/item/sword.json': '{"parent":"item/handheld"}\n',
      'assets/demo/textures/item/sword.png': 'TEXTURE',
    }

    const { files: output, summary, plan } = await fixResourcePack({
      files,
      targetVersion: '1.21.4',
    })

    expect(summary.errors).toEqual([])
    expect(plan.targetVersion).toBe('1.21.4')
    expect(plan.direction).toBe('forward')
    expect(plan.sourceVersion).toBe('1.20.4')

    // Non-JSON asset preserved
    expect(output['assets/demo/textures/item/sword.png']).toBe('TEXTURE')
    // pack.mcmeta updated
    const pm = JSON.parse(output['pack.mcmeta'])
    expect(pm.pack.pack_format).toBe(47)
  })
})

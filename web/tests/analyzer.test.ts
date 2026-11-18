import { describe, it, expect } from 'vitest'
import { buildResourceIndex } from '../src/engine/analyzer'

describe('analyzer PATH_TYPE_MAP and extractNamespaceAndName', () => {
  it('detects and extracts modern 1.21+ singular directories', () => {
    const files = {
      'data/my_pack/function/tick.mcfunction': 'say 1',
      'data/my_pack/function/nested/dir/func.mcfunction': 'say 2',
      'data/my_pack/loot_table/chests/simple.json': '{}',
      'data/my_pack/recipe/craft.json': '{}',
      'data/my_pack/advancement/root.json': '{}',
      'data/my_pack/predicate/is_sneaking.json': '{}',
      'data/my_pack/item_modifier/give_lore.json': '{}',
      'data/my_pack/tags/function/load.json': '{"values":[]}',
      'data/my_pack/tags/block/stone.json': '{"values":[]}',
      'data/my_pack/tags/item/swords.json': '{"values":[]}',
      'data/my_pack/tags/entity_type/zombies.json': '{"values":[]}',
      'data/my_pack/tags/game_event/vibrations.json': '{"values":[]}',
      'data/my_pack/tags/damage_type/fire.json': '{"values":[]}',
    }

    const resources = buildResourceIndex(files)

    const find = (type: string, name: string) =>
      resources.find(r => r.type === type && r.name === name && r.namespace === 'my_pack')

    expect(find('function', 'tick')).toBeDefined()
    expect(find('function', 'nested/dir/func')).toBeDefined()
    expect(find('loot_table', 'chests/simple')).toBeDefined()
    expect(find('recipe', 'craft')).toBeDefined()
    expect(find('advancement', 'root')).toBeDefined()
    expect(find('predicate', 'is_sneaking')).toBeDefined()
    expect(find('item_modifier', 'give_lore')).toBeDefined()
    expect(find('tag/function', 'load')).toBeDefined()
    expect(find('tag/block', 'stone')).toBeDefined()
    expect(find('tag/item', 'swords')).toBeDefined()
    expect(find('tag/entity_type', 'zombies')).toBeDefined()
    expect(find('tag/game_event', 'vibrations')).toBeDefined()
    expect(find('tag', 'damage_type/fire')).toBeDefined()
  })

  it('detects and extracts legacy plural directories', () => {
    const files = {
      'data/legacy_pack/functions/tick.mcfunction': 'say 1',
      'data/legacy_pack/functions/sub/legacy.mcfunction': 'say 2',
      'data/legacy_pack/loot_tables/chests/simple.json': '{}',
      'data/legacy_pack/recipes/craft.json': '{}',
      'data/legacy_pack/advancements/root.json': '{}',
      'data/legacy_pack/predicates/is_sneaking.json': '{}',
      'data/legacy_pack/item_modifiers/give_lore.json': '{}',
      'data/legacy_pack/tags/functions/load.json': '{"values":[]}',
      'data/legacy_pack/tags/blocks/stone.json': '{"values":[]}',
      'data/legacy_pack/tags/items/swords.json': '{"values":[]}',
      'data/legacy_pack/tags/entity_types/zombies.json': '{"values":[]}',
      'data/legacy_pack/tags/game_events/vibrations.json': '{"values":[]}',
    }

    const resources = buildResourceIndex(files)

    const find = (type: string, name: string) =>
      resources.find(r => r.type === type && r.name === name && r.namespace === 'legacy_pack')

    expect(find('function', 'tick')).toBeDefined()
    expect(find('function', 'sub/legacy')).toBeDefined()
    expect(find('loot_table', 'chests/simple')).toBeDefined()
    expect(find('recipe', 'craft')).toBeDefined()
    expect(find('advancement', 'root')).toBeDefined()
    expect(find('predicate', 'is_sneaking')).toBeDefined()
    expect(find('item_modifier', 'give_lore')).toBeDefined()
    expect(find('tag/function', 'load')).toBeDefined()
    expect(find('tag/block', 'stone')).toBeDefined()
    expect(find('tag/item', 'swords')).toBeDefined()
    expect(find('tag/entity_type', 'zombies')).toBeDefined()
    expect(find('tag/game_event', 'vibrations')).toBeDefined()
  })
})

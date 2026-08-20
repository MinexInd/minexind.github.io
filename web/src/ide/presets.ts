/**
 * Vanilla preset data, fetched per-version from the misode/mcmeta CDN (the same
 * source misode.github.io uses). Each datapack "registry" (recipe, loot_table,
 * advancement, …) publishes a `data/<registry>/data.min.json` summary of every
 * vanilla entry; we expose the id list and individual lookups so the IDE's
 * visual editors can seed a real, game-accurate starting point.
 *
 * Registries without a vanilla summary (predicate, tag) simply return [] / null
 * and the preset picker degrades to "No presets available".
 */

import type { JsonValue } from './mcdoc-edit'

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/misode/mcmeta'

interface CacheEntry {
  data: Record<string, JsonValue>
}

const cache = new Map<string, CacheEntry>()

function urlFor(version: string, registry: string): string {
  return `${CDN_BASE}@${version}-summary/data/${registry}/data.min.json`
}

async function load(version: string, registry: string): Promise<Record<string, JsonValue> | null> {
  const key = `${version}/${registry}`
  const cached = cache.get(key)
  if (cached) return cached.data

  try {
    const res = await fetch(urlFor(version, registry))
    if (!res.ok) return null
    const json = await res.json()
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
    const entry: CacheEntry = { data: json as Record<string, JsonValue> }
    cache.set(key, entry)
    return entry.data
  } catch {
    return null
  }
}

/**
 * Fetch sorted vanilla ids for a datapack registry in the given game version.
 * Returns [] on network failure or when the registry has no vanilla summary.
 */
export async function fetchPresetIds(version: string, registry: string): Promise<string[]> {
  const data = await load(version, registry)
  if (!data) return []
  return Object.keys(data).sort()
}

/**
 * Fetch a single vanilla preset by id for a registry in the given game version.
 * Returns null on failure or if the id does not exist.
 */
export async function fetchPreset(version: string, registry: string, id: string): Promise<JsonValue | null> {
  const data = await load(version, registry)
  if (!data) return null
  const entry = data[id]
  return entry !== undefined ? structuredClone(entry) : null
}

// ── Recipe-specific convenience wrappers ────────────────────────────────────

export async function fetchRecipeIds(version: string): Promise<string[]> {
  return fetchPresetIds(version, 'recipe')
}

export async function fetchRecipePreset(version: string, id: string): Promise<JsonValue | null> {
  return fetchPreset(version, 'recipe', id)
}

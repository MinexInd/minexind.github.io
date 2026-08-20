/**
 * Per-version vanilla registry data, fetched from the misode/mcmeta CDN — the
 * same source misode.github.io uses to populate its generator dropdowns and
 * preset lists. This is decoupled from Spyglass so the visual editors show real
 * vanilla ids (items, blocks, entities, sounds, …) for `#[id(...)]` fields even
 * before — or without — the language service has finished loading vanilla data.
 *
 * Because the data is version-tagged and cached per version, switching the
 * Minecraft version in the IDE reloads the correct id lists for that release.
 */

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/misode/mcmeta'

type RegistryMap = Record<string, string[]>

const registryCache = new Map<string, RegistryMap>()

async function fetchRegistries(version: string): Promise<RegistryMap> {
  const cached = registryCache.get(version)
  if (cached) return cached
  try {
    const res = await fetch(`${CDN_BASE}@${version}-summary/registries/data.min.json`)
    if (!res.ok) return {}
    const json = (await res.json()) as unknown
    const map: RegistryMap = json && typeof json === 'object' && !Array.isArray(json)
      ? (json as RegistryMap)
      : {}
    registryCache.set(version, map)
    return map
  } catch {
    return {}
  }
}

/**
 * Vanilla ids (with `minecraft:` prefix) for a registry, e.g. `"item"` ->
 * `["minecraft:apple", "minecraft:stone", …]`. Used by the searchable dropdowns
 * the schema-driven form renders for `#[id(item)]` / `#[id(block)]` / … fields.
 * Returns [] on network failure so the field degrades to a free-text input.
 */
export async function fetchRegistryEntries(version: string, registry: string): Promise<string[]> {
  const map = await fetchRegistries(version)
  const list = map[registry]
  if (!list || !Array.isArray(list)) return []
  return list
    .map((e) => (e.includes(':') ? e : `minecraft:${e}`))
    .sort()
}

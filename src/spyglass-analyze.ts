/**
 * spyglass-analyze — Version-driven Spyglass core analyzer for dpcheck.
 *
 * Boots a Spyglass Project + Service for a given datapack directory and target
 * Minecraft version, opens every supported file, and returns precise diagnostics
 * (file/line/column/severity/message/source) collected from Spyglass's own
 * parser, binder, checker, and linter.
 *
 * The version is supplied by the caller (CLI / MCP), NOT inferred from
 * pack.mcmeta. This lets users ask "does this pack work in 1.21.4?" directly.
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Service, Project, FileNode, VanillaConfig } from '@spyglassmc/core'
import { initialize as jeInitialize } from '@spyglassmc/java-edition'
import { initialize as mcdocInitialize } from '@spyglassmc/mcdoc'
import { getVanillaDatapack, getVanillaMcdoc } from '@spyglassmc/java-edition/lib/dependency/index.js'
import { getNodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import { getLogger } from './logger.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpyglassDiagnostic {
  file: string
  uri: string
  line: number
  column: number
  endLine: number
  endColumn: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
  code?: string
}

export interface SpyglassAnalysisResult {
  version: string
  diagnostics: SpyglassDiagnostic[]
  fileCount: number
  errorCount: number
  warningCount: number
}

// ---------------------------------------------------------------------------
// Cache — reuse the heavy vanilla-data load across repeated MCP calls
// ---------------------------------------------------------------------------

interface CacheKey {
  packDir: string
  version: string
}

interface CacheEntry {
  service: Service
  project: Project
}

const cache = new Map<string, CacheEntry>()

function cacheKeyOf(packDir: string, version: string): string {
  return `${packDir}::${version}`
}

export function clearSpyglassCache(): void {
  for (const entry of cache.values()) {
    entry.project.close().catch(() => {})
  }
  cache.clear()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_EXTS = new Set([
  '.mcfunction',
  '.json',
  '.mcmeta',
  '.nbt',
  '.snbt',
  '.mcdoc',
])

function guessLanguage(ext: string): string {
  if (ext === '.json' || ext === '.mcmeta') return 'json'
  if (ext === '.mcfunction') return 'mcfunction'
  if (ext === '.nbt' || ext === '.snbt') return 'snbt'
  return ''
}

function toSeverity(severity: number): SpyglassDiagnostic['severity'] {
  if (severity >= 3) return 'error'
  if (severity === 2) return 'warning'
  return 'info'
}

function toUri(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, '/')
  // Windows: "D:/x" must become "file:///D:/x". The old "file://D:/x" form put
  // the drive letter in the host position.
  if (/^[A-Za-z]:/.test(abs)) return 'file:///' + abs
  return 'file://' + abs
}

/** URI for a single file. No trailing slash — UriStore treats a trailing slash as a directory. */
function uriFromPath(p: string): string {
  return toUri(p)
}

/** URI for a directory root. Spyglass requires the trailing slash here. */
function dirUri(p: string): string {
  const uri = toUri(p)
  return uri.endsWith('/') ? uri : uri + '/'
}

function pathFromUri(uri: string): string {
  const raw = uri.replace(/^file:\/\//, '')
  // Spyglass normalizes Windows paths as "/c:/Users/..."
  const trimmed = raw.startsWith('/') && raw[2] === ':' ? raw.slice(1) : raw
  return trimmed.replace(/\/$/, '')
}

function walk(dir: string, cb: (full: string) => void): void {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, cb)
    else cb(full)
  }
}

/** Collect files under data/ (and assets/ for resource packs) that Spyglass can handle. */
function collectPackFiles(packDir: string): string[] {
  const out: string[] = []
  const roots = ['data', 'assets']
  for (const root of roots) {
    const full = path.join(packDir, root)
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue
    walk(full, (fp) => {
      const ext = path.extname(fp).toLowerCase()
      if (SUPPORTED_EXTS.has(ext)) out.push(fp)
    })
  }
  return out
}

/**
 * Create a Spyglass-compatible Logger from the project's Logger instance.
 *
 * The project's `Logger` class has private `log()` which makes it structurally
 * incompatible with Spyglass's `Logger` interface (which requires `log`).
 * We build a plain forwarding object that satisfies Spyglass while delegating
 * to the project's public methods.
 */
function createForwardingLogger(projectLogger: ReturnType<typeof getLogger>) {
  const fmt = (args: unknown[]) =>
    args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  return {
    error: (...args: unknown[]) => projectLogger.error(fmt(args)),
    warn: (...args: unknown[]) => projectLogger.warn(fmt(args)),
    info: (...args: unknown[]) => projectLogger.info(fmt(args)),
    log: (...args: unknown[]) => projectLogger.info(fmt(args)),
    children: () => createForwardingLogger(projectLogger),
  }
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export async function analyzePackWithSpyglass(
  packDir: string,
  version: string,
): Promise<SpyglassAnalysisResult> {
  const projectLogger = getLogger()
  const absPackDir = path.resolve(packDir)
  const packUri = dirUri(absPackDir)

  // Reuse cached project for this (dir, version) pair
  const key = cacheKeyOf(absPackDir, version)
  let entry = cache.get(key)
  if (!entry) {
    const externals = getNodeJsExternals()
    const cacheRoot = path.join(process.cwd(), '.spyglass-cache')
    fs.mkdirSync(cacheRoot, { recursive: true })
    const cacheRootUri = dirUri(cacheRoot)

    const logger = createForwardingLogger(projectLogger)

    let vanillaDep: Awaited<ReturnType<typeof getVanillaDatapack>> | undefined
    try {
      vanillaDep = await getVanillaDatapack(externals, logger, version)
    } catch (e) {
      projectLogger.warn(`[spyglass-analyze] failed to fetch vanilla datapack for ${version}: ${(e as Error).message}`)
    }

    let mcdocDep: Awaited<ReturnType<typeof getVanillaMcdoc>> | undefined
    try {
      mcdocDep = await getVanillaMcdoc(externals, logger)
    } catch (e) {
      projectLogger.warn(`[spyglass-analyze] failed to fetch vanilla mcdoc: ${(e as Error).message}`)
    }

    // The Project/Service constructors have cross-package type incompatibilities
    // (NodeJsExternals fs return types vs ProjectOptions expectations, and the
    // project's Logger class vs Spyglass's Logger interface). They work fine at
    // runtime; we cast through `as any` the same way mcdoc-check.ts casts
    // `getVanillaMcdoc(externals, logger)`.
    const projectOpts: Record<string, unknown> = {
      cacheRoot: cacheRootUri,
      externals,
      projectRoots: [packUri],
      logger,
      initializers: [jeInitialize, mcdocInitialize],
      // Spyglass only enumerates `config.env.dependencies` plus whatever a
      // FileWatcher reports. With no watcher, `projectRoots` are never scanned and
      // the pack's own files stay invisible, so every cross-file reference looks
      // undeclared. Listing the pack as a directory dependency makes Spyglass
      // index it exactly like the VS Code extension does.
      defaultConfig: {
        ...VanillaConfig,
        env: {
          ...VanillaConfig.env,
          // Without this, `resolveConfiguredVersion` never sees the requested
          // version: the datapack dependency and every mcdoc `since`/`until`
          // annotation fall back to the latest release, which is why old-version
          // packs reported schemas from newer versions.
          gameVersion: version,
          dependencies: [...VanillaConfig.env.dependencies, packUri],
        },
      },
    }
    if (vanillaDep) {
      ;(projectOpts as Record<string, unknown>).dependencies = {
        '@vanilla-datapack': vanillaDep,
        ...(mcdocDep ? { '@vanilla-mcdoc': mcdocDep } : {}),
      }
    }

    const project = new Project(projectOpts as unknown as ConstructorParameters<typeof Project>[0])
    const service = new Service({
      logger: logger as any,
      project: project as any,
    })

    await project.init()
    await project.ready()

    entry = { service, project }
    cache.set(key, entry)
  }

  const { project } = entry
  const files = collectPackFiles(absPackDir)
  const diagnostics: SpyglassDiagnostic[] = []

  // Listen for errors emitted during open/check
  const onError = (e: { errors: unknown[]; uri: string }) => {
    for (const err of e.errors) {
      if (!err || typeof err !== 'object') continue
      const le = err as {
        severity?: number
        message?: string
        range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
        source?: string
        code?: string
      }
      const r = le.range || {}
      diagnostics.push({
        file: pathFromUri(e.uri),
        uri: e.uri,
        line: (r.start?.line ?? 0) + 1,
        column: r.start?.character ?? 0,
        endLine: (r.end?.line ?? 0) + 1,
        endColumn: r.end?.character ?? 0,
        severity: toSeverity(le.severity ?? 3),
        message: le.message ?? 'Unknown error',
        source: le.source,
        code: le.code,
      })
    }
  }
  project.on('documentErrored', onError as (e: unknown) => void)

  // Pass 2 — open every file, then check every file. Opening and checking in the
  // same iteration re-checks earlier files against a symbol table that is still
  // missing the later ones.
  const opened: string[] = []
  for (const fp of files) {
    const lang = guessLanguage(path.extname(fp).toLowerCase())
    if (!lang) continue
    const uri = uriFromPath(fp)
    try {
      await project.onDidOpen(uri, lang, 1, fs.readFileSync(fp, 'utf-8'))
      opened.push(uri)
    } catch {
      // Individual file failures should not abort the whole pack analysis
    }
  }

  // Collect straight off the node we just checked. Looking files back up by URI
  // from `getTrackedFiles()` silently misses them: that list comes from the
  // dependency lister, which normalises URIs differently to `uriFromPath`, so
  // `getClientManaged(trackedUri)` returned undefined and every JSON diagnostic
  // was dropped.
  const seen = new Set<string>()
  const record = (uri: string, err: unknown) => {
    if (!err || typeof err !== 'object') return
    const le = err as {
      severity?: number
      message?: string
      range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
      source?: string
      code?: string
    }
    const r = le.range || {}
    const line = (r.start?.line ?? 0) + 1
    const column = r.start?.character ?? 0
    const message = le.message ?? 'Unknown error'
    const key = `${uri}|${line}|${column}|${message}`
    if (seen.has(key)) return
    seen.add(key)
    diagnostics.push({
      file: pathFromUri(uri),
      uri,
      line,
      column,
      endLine: (r.end?.line ?? 0) + 1,
      endColumn: r.end?.character ?? 0,
      severity: toSeverity(le.severity ?? 3),
      message,
      source: le.source,
      code: le.code,
    })
  }

  for (const uri of opened) {
    try {
      const res = await project.ensureClientManagedChecked(uri)
      const node = res?.node as unknown as {
        parserErrors?: unknown[]
        binderErrors?: unknown[]
        checkerErrors?: unknown[]
        linterErrors?: unknown[]
      } | undefined
      if (!node) continue
      for (const err of [
        ...(node.parserErrors ?? []),
        ...(node.binderErrors ?? []),
        ...(node.checkerErrors ?? []),
        ...(node.linterErrors ?? []),
      ]) {
        record(uri, err)
      }
    } catch {
      // A single file failing to check should not abort the whole pack
    }
  }

  const errorCount = diagnostics.filter(d => d.severity === 'error').length
  const warningCount = diagnostics.filter(d => d.severity === 'warning').length

  return {
    version,
    diagnostics,
    fileCount: files.length,
    errorCount,
    warningCount,
  }
}

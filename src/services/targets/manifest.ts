/**
 * Manifest-aware kind classification.
 *
 * Real hub bundles (Copilot-style) keep every primitive under `prompts/` and
 * disambiguate via `deployment-manifest.yml` `type:` fields. So a file's KIND
 * must be resolved as: manifest type (authoritative) → filename extension →
 * top-level folder. This is what makes deployment correct for existing
 * collections, not just folder-structured new ones.
 */
import * as yaml from 'js-yaml';

import { FOLDER_TO_KIND } from './target-types';
import type { PrimitiveKind } from './target-types';

/** A file that has been assigned a canonical kind. */
export interface ClassifiedFile {
  /** Original bundle-relative path, e.g. "prompts/Hunter.agent.md". */
  relPath: string;
  /** File content. */
  content: string;
  /** Resolved canonical kind, or null if it could not be classified. */
  kind: PrimitiveKind | null;
  /** Path within the kind (source top-folder stripped), e.g. "Hunter.agent.md". */
  remainder: string;
  /** Manifest id/name, when available. */
  id?: string;
  name?: string;
}

/** file path (posix) → {kind, id, name} from the manifest. */
export type ManifestIndex = Map<string, { kind: PrimitiveKind; id?: string; name?: string }>;

const toPosix = (p: string): string => p.replaceAll('\\', '/');

/** Normalize a manifest `type` string to a canonical kind. */
function normalizeType(type: unknown): PrimitiveKind | null {
  if (typeof type !== 'string') {
    return null;
  }
  switch (type.toLowerCase()) {
    case 'prompt':
      return 'prompt';
    case 'agent':
      return 'agent';
    case 'instruction':
    case 'instructions':
      return 'instruction';
    case 'chatmode':
      return 'chatmode';
    case 'skill':
      return 'skill';
    case 'hook':
      return 'hook';
    case 'plugin':
      return 'plugin';
    default:
      return null;
  }
}

/**
 * Parse a deployment-manifest.yml into a path→kind index.
 * The manifest's `prompts:` array is a misnomer — it lists ALL primitives,
 * each with its own `type`.
 */
export function parseManifest(manifestYaml: string): ManifestIndex {
  const index: ManifestIndex = new Map();
  let doc: unknown;
  try {
    doc = yaml.load(manifestYaml);
  } catch {
    return index;
  }
  if (!doc || typeof doc !== 'object') {
    return index;
  }
  const entries = (doc as { prompts?: unknown }).prompts;
  if (!Array.isArray(entries)) {
    return index;
  }
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const e = raw as { file?: unknown; type?: unknown; id?: unknown; name?: unknown };
    if (typeof e.file !== 'string') {
      continue;
    }
    const kind = normalizeType(e.type);
    if (kind === null) {
      continue;
    }
    index.set(toPosix(e.file), {
      kind,
      id: typeof e.id === 'string' ? e.id : undefined,
      name: typeof e.name === 'string' ? e.name : undefined
    });
  }
  return index;
}

/** Classify by filename extension (second-priority signal). */
function classifyByExtension(relPath: string): PrimitiveKind | null {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.agent.md')) {
    return 'agent';
  }
  if (lower.endsWith('.prompt.md')) {
    return 'prompt';
  }
  if (lower.endsWith('.instructions.md')) {
    return 'instruction';
  }
  if (lower.endsWith('.chatmode.md')) {
    return 'chatmode';
  }
  if (lower.endsWith('/skill.md') || lower === 'skill.md') {
    return 'skill';
  }
  return null;
}

/** The part of the path after the first folder segment (source folder stripped). */
function stripTopFolder(relPath: string): string {
  const posix = toPosix(relPath);
  const slash = posix.indexOf('/');
  return slash === -1 ? posix : posix.slice(slash + 1);
}

/**
 * Classify one file: manifest type → extension → top folder.
 * @param relPath - Bundle-relative path.
 * @param content - File content.
 * @param manifest - Parsed manifest index (may be empty).
 */
export function classifyFile(relPath: string, content: string, manifest: ManifestIndex): ClassifiedFile {
  const posix = toPosix(relPath);
  const fromManifest = manifest.get(posix);

  let kind: PrimitiveKind | null = fromManifest?.kind ?? classifyByExtension(posix);
  if (kind === null) {
    const topFolder = posix.includes('/') ? posix.slice(0, posix.indexOf('/')) : '';
    kind = FOLDER_TO_KIND[topFolder] ?? null;
  }

  return {
    relPath: posix,
    content,
    kind,
    remainder: stripTopFolder(posix),
    id: fromManifest?.id,
    name: fromManifest?.name
  };
}

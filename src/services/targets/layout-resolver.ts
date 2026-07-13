/**
 * LayoutResolver — answers "WHERE does this primitive go?" for a target.
 *
 * It routes by canonical KIND (resolved from the manifest/extension), not by the
 * source folder — so an agent packaged under `prompts/` still lands in the
 * agents location. It also accepts a post-transform `remainder` (filename may
 * have changed, e.g. `foo.agent.md` → `foo.md` / `foo.json`).
 */
import * as path from 'node:path';

import { KIND_ROUTE_KEY } from './target-types';
import type { PrimitiveKind, Target, TargetScope, TargetType } from './target-types';

export interface ScopedLayout {
  baseDir: string;
  /** kindRoutes keyed by the folder form ("agents/", "prompts/", …). */
  kindRoutes: Record<string, string>;
  skipPaths: string[];
  /** Catch-all for kinds with no explicit route — ADAPT instead of dropping. */
  fallbackRoute?: string;
}

export type LayoutConfig = Record<TargetType, Partial<Record<TargetScope, ScopedLayout>>>;

export interface LayoutVars {
  HOME: string;
  workspaceRoot?: string;
  [key: string]: string | undefined;
}

export interface ResolveResult {
  dest: string;
  viaFallback: boolean;
}

function expand(input: string, vars: LayoutVars): string {
  return input.replace(/\$\{(\w+)\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`LayoutResolver: undefined variable \${${name}} in "${input}"`);
    }
    return value;
  });
}

const toPosix = (p: string): string => p.replaceAll('\\', '/');

export class LayoutResolver {
  public constructor(private readonly layouts: LayoutConfig) {}

  public supports(type: TargetType, scope: TargetScope): boolean {
    return Boolean(this.layouts[type]?.[scope]);
  }

  /** Should this file be excluded entirely (e.g. README, manifest)? */
  public isSkipped(target: Target, relPath: string): boolean {
    const scoped = this.layouts[target.type]?.[target.scope];
    if (!scoped) {
      return true;
    }
    const rel = toPosix(relPath);
    return scoped.skipPaths.some((skip) => rel === skip || rel.startsWith(toPosix(skip)));
  }

  /**
   * Resolve the destination for a classified file.
   * @param target   - target type + scope + workspaceRoot.
   * @param kind     - canonical kind (null = unclassified).
   * @param remainder- post-transform path within the kind, e.g. "Hunter.md".
   * @param relPath  - original bundle-relative path (for fallback preservation).
   * @param vars     - variables for baseDir expansion.
   */
  public resolve(
    target: Target,
    kind: PrimitiveKind | null,
    remainder: string,
    relPath: string,
    vars: LayoutVars
  ): ResolveResult | null {
    const scoped = this.layouts[target.type]?.[target.scope];
    if (!scoped) {
      return null;
    }
    const base = expand(scoped.baseDir, vars);

    if (kind !== null) {
      const routeKey = KIND_ROUTE_KEY[kind];
      const route = scoped.kindRoutes[routeKey];
      if (route !== undefined) {
        return { dest: path.join(base, route, remainder), viaFallback: false };
      }
      // Known kind but this target has no route for it → adapt under fallback.
      if (scoped.fallbackRoute !== undefined) {
        return { dest: path.join(base, scoped.fallbackRoute, routeKey, remainder), viaFallback: true };
      }
      return null;
    }

    // Unclassified file → fallback (preserve original relative path) or skip.
    if (scoped.fallbackRoute !== undefined) {
      return { dest: path.join(base, scoped.fallbackRoute, toPosix(relPath)), viaFallback: true };
    }
    return null;
  }
}

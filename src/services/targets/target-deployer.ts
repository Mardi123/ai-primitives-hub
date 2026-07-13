/**
 * TargetDeployer — orchestrates a bundle deploy to a target.
 *
 * Pipeline per file:  classify (manifest/ext/folder) → convert (per target+kind)
 *                     → resolve destination (route by kind) → write.
 *
 * Works for EXISTING collections (Copilot bundles with a deployment-manifest,
 * agents under prompts/) and NEW collections (folder-structured). The
 * FileSystem is injected so the same engine runs in the extension and the CLI.
 */
import * as os from 'node:os';

import { convert } from './converter';
import { LayoutResolver } from './layout-resolver';
import type { LayoutConfig, LayoutVars } from './layout-resolver';
import { classifyFile, parseManifest } from './manifest';
import type { ManifestIndex } from './manifest';
import type { Target } from './target-types';
import layoutsData from './layouts.json';

/** One file inside a bundle. */
export interface BundleFile {
  /** Path relative to the bundle root, e.g. "prompts/Hunter.agent.md". */
  relPath: string;
  content: string;
}

/** Minimal filesystem port (injected — keeps the engine runtime-agnostic). */
export interface FileSystemPort {
  ensureDir(dir: string): Promise<void>;
  writeFile(absPath: string, content: string): Promise<void>;
}

export interface DeployedFile {
  relPath: string;
  destPath: string;
  kind: string | null;
  adapted: boolean;
}

export interface DeployResult {
  written: DeployedFile[];
  skipped: string[];
  adapted: string[];
  /** Non-fatal conversion diagnostics (unknown tools, dropped fields, MCP…). */
  warnings: string[];
}

const MANIFEST_NAME = 'deployment-manifest.yml';

export interface DeployerOptions {
  resolver?: LayoutResolver;
  /** MCP server name registry for resolving agent tool refs (Kiro). */
  mcpRegistry?: Record<string, string>;
}

export class TargetDeployer {
  private readonly resolver: LayoutResolver;
  private readonly mcpRegistry: Record<string, string>;

  public constructor(private readonly fs: FileSystemPort, options: DeployerOptions = {}) {
    this.resolver =
      options.resolver ?? new LayoutResolver((layoutsData as { layouts: LayoutConfig }).layouts);
    this.mcpRegistry = options.mcpRegistry ?? {};
  }

  private buildVars(target: Target): LayoutVars {
    if (target.scope === 'repository' && !target.workspaceRoot) {
      throw new Error('TargetDeployer: repository scope requires target.workspaceRoot');
    }
    return { HOME: os.homedir(), workspaceRoot: target.workspaceRoot };
  }

  private findManifest(files: BundleFile[]): ManifestIndex {
    const manifest = files.find((f) => f.relPath.replaceAll('\\', '/').endsWith(MANIFEST_NAME));
    return manifest ? parseManifest(manifest.content) : new Map();
  }

  /** Compute the deploy plan without writing (preview / dry-run / tests). */
  public plan(files: BundleFile[], target: Target): DeployResult {
    return this.run(files, target, false);
  }

  /** Deploy a bundle's files to a target. */
  public async deploy(files: BundleFile[], target: Target): Promise<DeployResult> {
    const result = this.run(files, target, true);
    for (const w of result.written) {
      await this.fs.ensureDir(dirname(w.destPath));
      await this.fs.writeFile(w.destPath, this.pendingContent.get(w.destPath) ?? '');
    }
    this.pendingContent.clear();
    return result;
  }

  private readonly pendingContent = new Map<string, string>();

  private run(files: BundleFile[], target: Target, capture: boolean): DeployResult {
    const vars = this.buildVars(target);
    const manifest = this.findManifest(files);
    const written: DeployedFile[] = [];
    const skipped: string[] = [];
    const adapted: string[] = [];
    const warnings: string[] = [];

    for (const file of files) {
      if (this.resolver.isSkipped(target, file.relPath)) {
        skipped.push(file.relPath);
        continue;
      }

      const classified = classifyFile(file.relPath, file.content, manifest);
      const converted = convert(classified, target, this.mcpRegistry);
      converted.warnings.forEach((w) => warnings.push(`[${file.relPath}] ${w}`));

      const resolved = this.resolver.resolve(
        target,
        classified.kind,
        converted.remainder,
        file.relPath,
        vars
      );
      if (resolved === null) {
        skipped.push(file.relPath);
        continue;
      }

      if (resolved.viaFallback) {
        adapted.push(file.relPath);
      }
      if (capture) {
        this.pendingContent.set(resolved.dest, converted.content);
      }
      written.push({
        relPath: file.relPath,
        destPath: resolved.dest,
        kind: classified.kind,
        adapted: resolved.viaFallback
      });
    }

    return { written, skipped, adapted, warnings };
  }
}

/** dirname without importing node:path (bundler-friendly, no backtracking regex). */
function dirname(p: string): string {
  let end = p.length;
  while (end > 0 && (p[end - 1] === '/' || p[end - 1] === '\\')) {
    end--;
  }
  const trimmed = p.slice(0, end);
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? '.' : trimmed.slice(0, idx);
}

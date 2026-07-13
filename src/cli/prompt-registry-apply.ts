#!/usr/bin/env node
/**
 * `prompt-registry apply` — headless deploy of a bundle to a target runtime.
 *
 * This is the CLI path for runtimes that have NO extension host (Claude Code,
 * Copilot CLI). It reuses the SAME engine as the extension (src/services/targets),
 * proving the vscode-free design.
 *
 * Usage:
 *   prompt-registry-apply --bundle <dir> --target <type> [--scope user|repository]
 *                         [--workspace <dir>] [--dry-run]
 *
 * Example (Claude Code, user scope):
 *   prompt-registry-apply --bundle ./my-bundle --target claude-code
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { TargetDeployer } from '../services/targets/target-deployer';
import type { BundleFile, FileSystemPort } from '../services/targets/target-deployer';
import { isTargetType } from '../services/targets/target-types';
import type { Target, TargetScope } from '../services/targets/target-types';

/** node:fs implementation of the engine's FileSystem port. */
const nodeFs: FileSystemPort = {
  async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  },
  async writeFile(absPath: string, content: string): Promise<void> {
    await fs.writeFile(absPath, content, 'utf8');
  }
};

/** Recursively collect a bundle's files as {relPath, content}. */
async function collectBundleFiles(root: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const relPath = path.relative(root, abs).replace(/\\/g, '/');
        files.push({ relPath, content: await fs.readFile(abs, 'utf8') });
      }
    }
  }
  await walk(root);
  return files;
}

interface Args {
  bundle?: string;
  target?: string;
  scope: TargetScope;
  workspace?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { scope: 'user', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--bundle': args.bundle = argv[++i]; break;
      case '--target': args.target = argv[++i]; break;
      case '--scope': args.scope = argv[++i] as TargetScope; break;
      case '--workspace': args.workspace = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      default: throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.bundle || !args.target) {
    process.stderr.write('Usage: prompt-registry-apply --bundle <dir> --target <type> [--scope user|repository] [--workspace <dir>] [--dry-run]\n');
    return 2;
  }
  if (!isTargetType(args.target)) {
    process.stderr.write(`Unknown target "${args.target}".\n`);
    return 2;
  }
  if (args.scope === 'repository' && !args.workspace) {
    process.stderr.write('Repository scope requires --workspace <dir>.\n');
    return 2;
  }

  const target: Target = {
    type: args.target,
    scope: args.scope,
    workspaceRoot: args.workspace
  };

  const files = await collectBundleFiles(path.resolve(args.bundle));
  const deployer = new TargetDeployer(nodeFs);

  if (args.dryRun) {
    const plan = deployer.plan(files, target);
    for (const w of plan.written) {
      const flag = w.adapted ? 'A' : ' ';
      process.stdout.write(`${flag} [${w.kind ?? '?'}] ${w.relPath}  ->  ${w.destPath}\n`);
    }
    process.stdout.write(
      `\n${plan.written.length} file(s) would be written, ${plan.skipped.length} skipped` +
        `${plan.adapted.length ? `, ${plan.adapted.length} adapted` : ''}.\n`
    );
    for (const warn of plan.warnings) {
      process.stdout.write(`  warning: ${warn}\n`);
    }
    return 0;
  }

  const result = await deployer.deploy(files, target);
  process.stdout.write(
    `Deployed ${result.written.length} file(s) to ${target.type} (${target.scope}); ` +
      `${result.skipped.length} skipped${result.adapted.length ? `, ${result.adapted.length} adapted` : ''}.\n`
  );
  for (const warn of result.warnings) {
    process.stdout.write(`  warning: ${warn}\n`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

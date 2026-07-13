/**
 * Bridge between the bundle installer and the multi-IDE target engine.
 *
 * Reads an extracted bundle directory (which contains deployment-manifest.yml
 * and the primitive files) and deploys it to a target runtime using the engine.
 * Kept `vscode`-free (node:fs only) so the engine stays reusable by the CLI.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { TargetDeployer } from './targets/target-deployer';
import type { BundleFile, DeployResult, FileSystemPort } from './targets/target-deployer';
import type { Target } from './targets/target-types';

const nodeFs: FileSystemPort = {
  async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  },
  async writeFile(absPath: string, content: string): Promise<void> {
    await fs.writeFile(absPath, content, 'utf8');
  }
};

/** Recursively read a bundle directory into {relPath, content} entries. */
async function readBundleDir(root: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const relPath = path.relative(root, abs).replaceAll('\\', '/');
        files.push({ relPath, content: await fs.readFile(abs, 'utf8') });
      }
    }
  }
  await walk(root);
  return files;
}

/**
 * Deploy an extracted bundle directory to a target using the engine.
 * @param sourceDir - Directory containing the bundle (manifest + files).
 * @param target - Resolved target (type + scope + workspaceRoot).
 * @param mcpRegistry - Optional MCP server registry for agent tool resolution.
 */
export async function deployDirectoryToTarget(
  sourceDir: string,
  target: Target,
  mcpRegistry: Record<string, string> = {}
): Promise<DeployResult> {
  const files = await readBundleDir(sourceDir);
  const deployer = new TargetDeployer(nodeFs, { mcpRegistry });
  return deployer.deploy(files, target);
}

/** Path to Kiro's mcp.json for a target's scope. */
function kiroMcpPath(target: Target): string {
  const base = target.scope === 'repository' ? (target.workspaceRoot ?? '') : os.homedir();
  return path.join(base, '.kiro', 'settings', 'mcp.json');
}

async function readMcpJson(file: string): Promise<{ mcpServers: Record<string, unknown> }> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return { mcpServers: parsed?.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {} };
  } catch {
    return { mcpServers: {} };
  }
}

/**
 * Merge a bundle's MCP servers into Kiro's mcp.json (same schema as the manifest).
 * @returns the server names that were written.
 */
export async function syncKiroMcpServers(target: Target, servers: Record<string, unknown> | undefined): Promise<string[]> {
  const names = servers ? Object.keys(servers) : [];
  if (names.length === 0) {
    return [];
  }
  const file = kiroMcpPath(target);
  const doc = await readMcpJson(file);
  for (const name of names) {
    doc.mcpServers[name] = servers![name];
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return names;
}

/** Remove a bundle's MCP servers from Kiro's mcp.json (best-effort). */
export async function removeKiroMcpServers(target: Target, serverNames: string[]): Promise<void> {
  if (serverNames.length === 0) {
    return;
  }
  const file = kiroMcpPath(target);
  try {
    await fs.access(file);
  } catch {
    return; // nothing to clean
  }
  const doc = await readMcpJson(file);
  let changed = false;
  for (const name of serverNames) {
    if (name in doc.mcpServers) {
      delete doc.mcpServers[name];
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  }
}

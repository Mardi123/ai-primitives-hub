/**
 * "Deploy bundle to target…" command.
 *
 * A thin, additive command that exercises the multi-IDE target engine
 * (src/services/targets) from inside the extension. It lets a user pick a
 * bundle folder, a target runtime (defaulted to the host editor via the
 * IDE detector), and a scope, then deploys using TargetDeployer.
 *
 * This deliberately does NOT touch the existing Copilot/VS Code install path
 * (BundleInstaller / scope services) — it is a separate entry point so it
 * cannot introduce regressions. The vscode.workspace.fs adapter lives here,
 * NOT in the engine, so the engine stays vscode-free and CLI-reusable.
 */
import * as vscode from 'vscode';

import { TargetDeployer } from '../services/targets/target-deployer';
import type { BundleFile, FileSystemPort } from '../services/targets/target-deployer';
import { detectTargetFromAppName } from '../services/targets/ide-detector';
import { TARGET_TYPES } from '../services/targets/target-types';
import type { Target, TargetScope, TargetType } from '../services/targets/target-types';

/** FileSystemPort backed by vscode.workspace.fs (works in remote/virtual FS too). */
const vscodeFs: FileSystemPort = {
  async ensureDir(dir: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
  },
  async writeFile(absPath: string, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(absPath), Buffer.from(content, 'utf8'));
  }
};

/** Recursively read a bundle folder into {relPath, content} entries. */
async function readBundle(rootUri: vscode.Uri): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  const walk = async (dir: vscode.Uri, prefix: string): Promise<void> => {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, kind] of entries) {
      const child = vscode.Uri.joinPath(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (kind === vscode.FileType.Directory) {
        await walk(child, rel);
      } else if (kind === vscode.FileType.File) {
        const bytes = await vscode.workspace.fs.readFile(child);
        files.push({ relPath: rel, content: Buffer.from(bytes).toString('utf8') });
      }
    }
  };
  await walk(rootUri, '');
  return files;
}

/** Register the command; returns the disposable. */
export function registerDeployToTargetCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('promptRegistry.deployToTarget', async () => {
    try {
      // 1. Pick the bundle folder.
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select bundle folder to deploy'
      });
      if (!picked || picked.length === 0) {
        return;
      }
      const bundleUri = picked[0];

      // 2. Pick the target runtime (default = the editor we're running in).
      const detected = detectTargetFromAppName(vscode.env.appName);
      const typePick = await vscode.window.showQuickPick(
        TARGET_TYPES.map((t) => ({
          label: t === detected ? `${t}  (detected)` : t,
          value: t as TargetType
        })),
        { title: 'Deploy to which target runtime?', placeHolder: detected }
      );
      if (!typePick) {
        return;
      }

      // 3. Pick the scope.
      const scopePick = await vscode.window.showQuickPick(
        [
          { label: 'user — deploy to your home config', value: 'user' as TargetScope },
          { label: 'repository — deploy into this workspace', value: 'repository' as TargetScope }
        ],
        { title: 'Deploy scope?' }
      );
      if (!scopePick) {
        return;
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (scopePick.value === 'repository' && !workspaceRoot) {
        void vscode.window.showErrorMessage('Repository scope requires an open workspace folder.');
        return;
      }

      const target: Target = {
        type: typePick.value,
        scope: scopePick.value,
        workspaceRoot
      };

      // 4. Deploy.
      const files = await readBundle(bundleUri);
      const deployer = new TargetDeployer(vscodeFs);
      const result = await deployer.deploy(files, target);

      const adaptedNote =
        result.adapted.length > 0 ? ` (${result.adapted.length} adapted via fallback)` : '';
      void vscode.window.showInformationMessage(
        `Deployed ${result.written.length} file(s) to ${target.type} (${target.scope}); ` +
          `${result.skipped.length} skipped${adaptedNote}.`
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Deploy to target failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

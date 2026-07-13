/**
 * IDE detection — map an editor's identity to a default TargetType.
 *
 * Kept vscode-free: callers pass in the app name (in the extension, that's
 * `vscode.env.appName`; in tests, any string). This lets us default the deploy
 * target to the editor the user is actually running.
 */
import type { TargetType } from './target-types';

/**
 * Detect the default target type from the host editor's app name.
 * @param appName - e.g. vscode.env.appName ("Visual Studio Code", "Kiro", ...).
 * @returns The best-guess TargetType, defaulting to 'vscode'.
 */
export function detectTargetFromAppName(appName: string | undefined): TargetType {
  const name = (appName ?? '').toLowerCase();
  if (name.includes('kiro')) {
    // Default to the Kiro IDE unified (Markdown) agent surface.
    return 'kiro-ide';
  }
  if (name.includes('windsurf')) {
    return 'windsurf';
  }
  if (name.includes('insider')) {
    return 'vscode-insiders';
  }
  // Cursor and other VS Code forks behave like vscode for deployment purposes.
  return 'vscode';
}

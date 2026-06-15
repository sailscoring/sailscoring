import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * ADR-009 M3 — CLI configuration. The CLI is a pure `/api/v1` client, so it
 * stores only what it needs to reach a deployment: the base URL and a Bearer
 * token. Config lives at `$XDG_CONFIG_HOME/sailscoring/config.json` (falling
 * back to `~/.config/...`). Environment variables override the file, so CI and
 * one-off invocations don't have to write it.
 */

export const DEFAULT_BASE_URL = 'https://app.sailscoring.ie';

export interface CliConfig {
  baseUrl: string;
  token?: string;
}

export function configPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()
      ? process.env.XDG_CONFIG_HOME
      : join(homedir(), '.config');
  return join(base, 'sailscoring', 'config.json');
}

/** Read the stored config, or an empty default when none exists. */
export function readConfig(): CliConfig {
  const path = configPath();
  if (!existsSync(path)) return { baseUrl: DEFAULT_BASE_URL };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<CliConfig>;
    return {
      baseUrl: parsed.baseUrl?.trim() || DEFAULT_BASE_URL,
      token: parsed.token,
    };
  } catch {
    return { baseUrl: DEFAULT_BASE_URL };
  }
}

/** Persist config, creating the directory and restricting the file to the
 *  owner — it holds a secret. */
export function writeConfig(config: CliConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Effective config for a command: stored file, with environment variables and
 * an explicit `--base-url` flag layered on top (flag wins, then env, then
 * file). `SAILSCORING_TOKEN` lets CI auth without a login step.
 */
export function resolveConfig(opts?: { baseUrl?: string }): CliConfig {
  const file = readConfig();
  const baseUrl =
    opts?.baseUrl?.trim() ||
    process.env.SAILSCORING_BASE_URL?.trim() ||
    file.baseUrl;
  const token = process.env.SAILSCORING_TOKEN?.trim() || file.token;
  return { baseUrl, token };
}

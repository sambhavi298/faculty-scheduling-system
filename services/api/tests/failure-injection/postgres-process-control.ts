import { execSync } from 'child_process';

/**
 * Cross-platform PostgreSQL process control for the failure-injection
 * suite (`failure-injection.test.ts`). Pulled into its own module so the
 * command-resolution *logic* (which command string gets picked for a given
 * platform/env-var combination) can be unit-tested without needing a real
 * Windows machine or a real PostgreSQL service — see
 * `postgres-process-control.test.ts`.
 *
 * BACKGROUND: this previously hardcoded `net stop postgresql-x64-16` /
 * `net start postgresql-x64-16` as the Windows default. That broke on any
 * machine running a different PostgreSQL major version — confirmed by a
 * real failure on a Windows/PostgreSQL 18 machine: "Command failed: net
 * stop postgresql-x64-16 / The service name is invalid." Hardcoding a
 * second version number (e.g. 18) would only move the same bug two years
 * down the road. Fix: resolve the actual Windows service name at runtime
 * instead of hardcoding any version.
 *
 * Resolution order, each overriding the next:
 *   1. PG_STOP_CMD / PG_START_CMD — full command override (already existed;
 *      use this for anything not covered by the two options below, e.g. a
 *      non-Windows/non-"service postgresql" setup).
 *   2. PG_WINDOWS_SERVICE_NAME — just the Windows service name, if you know
 *      it and don't want to rely on auto-detection (or have more than one
 *      "postgresql*" service installed and need to pick a specific one).
 *   3. Auto-detected via `Get-Service -Name postgresql*` (PowerShell) — the
 *      default. Works for any installed PostgreSQL version without this
 *      file ever needing to know which one.
 *   4. Non-Windows platforms are untouched: `service postgresql start/stop`.
 */

export function detectWindowsPostgresServiceName(): string {
  let output: string;
  try {
    output = execSync(
      'powershell -NoProfile -Command "(Get-Service -Name \'postgresql*\' -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Name)"',
      { encoding: 'utf8' }
    ).trim();
  } catch (err) {
    throw new Error(
      'Could not auto-detect a Windows PostgreSQL service via PowerShell (Get-Service -Name postgresql*). ' +
      'Confirm PostgreSQL is installed as a Windows service and PowerShell is on PATH, or set ' +
      'PG_WINDOWS_SERVICE_NAME (just the service name) or PG_STOP_CMD/PG_START_CMD (full commands) to bypass detection. ' +
      `Underlying error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!output) {
    throw new Error(
      'Get-Service -Name postgresql* returned no matching Windows service. ' +
      'Confirm your PostgreSQL service name with `Get-Service -Name postgresql*` in PowerShell, then set ' +
      'PG_WINDOWS_SERVICE_NAME to that exact name (or set PG_STOP_CMD/PG_START_CMD directly).'
    );
  }
  return output;
}

/**
 * Resolves and caches the Windows service name for this process (avoids
 * re-running the PowerShell detection command on every stop/start call —
 * detection can only run on `win32`, and the answer can't change mid-run).
 */
let cachedWindowsServiceName: string | null = null;
function resolveWindowsServiceName(detect: () => string = detectWindowsPostgresServiceName): string {
  if (process.env.PG_WINDOWS_SERVICE_NAME) {
    return process.env.PG_WINDOWS_SERVICE_NAME;
  }
  if (cachedWindowsServiceName === null) {
    cachedWindowsServiceName = detect();
  }
  return cachedWindowsServiceName;
}

/** Exposed only for postgres-process-control.test.ts, to reset the cache between test cases. */
export function _resetWindowsServiceNameCacheForTests(): void {
  cachedWindowsServiceName = null;
}

/**
 * Pure decision logic (no side effects) for which stop/start command to
 * run, given the current platform and environment variables. Separated
 * from the actual `execSync` calls below so this can be unit-tested
 * directly: same inputs (platform, env vars, and — on win32 — the detected
 * service name), same output, on any machine.
 */
export function resolveStopCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, windowsServiceName: () => string): string {
  if (env.PG_STOP_CMD) return env.PG_STOP_CMD;
  if (platform === 'win32') return `net stop ${windowsServiceName()}`;
  return 'service postgresql stop';
}

export function resolveStartCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, windowsServiceName: () => string): string {
  if (env.PG_START_CMD) return env.PG_START_CMD;
  if (platform === 'win32') return `net start ${windowsServiceName()}`;
  return 'service postgresql start';
}

export function stopPostgres(): void {
  const cmd = resolveStopCommand(process.platform, process.env, resolveWindowsServiceName);
  execSync(cmd);
}

export function startPostgres(): void {
  const cmd = resolveStartCommand(process.platform, process.env, resolveWindowsServiceName);
  try {
    execSync(cmd);
  } catch {
    // Discovered on a real Windows run: this test's own body already
    // restarts Postgres before finishing, then the failure-injection
    // suite's afterEach calls startPostgres() again unconditionally "to
    // always leave Postgres running for every other test file" — which is
    // the right end goal, but on Windows, `net start` on an
    // ALREADY-running service exits non-zero ("The requested service has
    // already been started."), unlike Debian's `service ... start`, which
    // tolerates it. This function's actual contract is "Postgres ends up
    // running", not "this specific command had to do work" — so a failed
    // start attempt here is not fatal by itself; waitForPostgresUp() right
    // after every call site is the real check, and it will correctly throw
    // if Postgres genuinely isn't up for some other reason.
  }
}

export function waitForPostgresUp(timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync('pg_isready -h 127.0.0.1 -p 5432', { stdio: 'ignore' });
      return;
    } catch {
      // not ready yet, keep polling
    }
  }
  throw new Error('Postgres did not come back up within the timeout');
}

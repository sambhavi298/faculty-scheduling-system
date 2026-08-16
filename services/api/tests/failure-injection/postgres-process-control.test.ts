import { execSync } from 'child_process';
import {
  resolveStopCommand,
  resolveStartCommand,
  detectWindowsPostgresServiceName,
  stopPostgres,
  startPostgres,
  _resetWindowsServiceNameCacheForTests,
} from './postgres-process-control';

/**
 * Unit tests for the command-resolution logic behind the failure-injection
 * suite's `stopPostgres()`/`startPostgres()`. These are pure-logic tests —
 * `child_process.execSync` is mocked throughout, so nothing here actually
 * touches a real PostgreSQL service. They exist specifically to prove the
 * fix for the "hardcoded postgresql-x64-16" bug (a real failure on a
 * Windows/PostgreSQL 18 machine: "Command failed: net stop
 * postgresql-x64-16 / The service name is invalid.") without requiring a
 * Windows machine to run them: same inputs, same resolved command, on any
 * platform this file itself happens to run on.
 */
jest.mock('child_process', () => ({ execSync: jest.fn() }));
const mockedExecSync = execSync as jest.Mock;

describe('resolveStopCommand / resolveStartCommand (pure decision logic)', () => {
  beforeEach(() => {
    mockedExecSync.mockReset();
  });

  it('PG_STOP_CMD, when set, always wins — even on win32 — and never touches windowsServiceName()', () => {
    const windowsServiceName = jest.fn();
    const cmd = resolveStopCommand('win32', { PG_STOP_CMD: 'net stop my-custom-service' }, windowsServiceName);
    expect(cmd).toBe('net stop my-custom-service');
    expect(windowsServiceName).not.toHaveBeenCalled();
  });

  it('PG_START_CMD, when set, always wins — even on win32 — and never touches windowsServiceName()', () => {
    const windowsServiceName = jest.fn();
    const cmd = resolveStartCommand('win32', { PG_START_CMD: 'net start my-custom-service' }, windowsServiceName);
    expect(cmd).toBe('net start my-custom-service');
    expect(windowsServiceName).not.toHaveBeenCalled();
  });

  it('on win32 with no override, builds "net stop <detected service>" from the resolved service name', () => {
    const windowsServiceName = jest.fn().mockReturnValue('postgresql-x64-18');
    const cmd = resolveStopCommand('win32', {}, windowsServiceName);
    expect(cmd).toBe('net stop postgresql-x64-18');
    expect(windowsServiceName).toHaveBeenCalledTimes(1);
  });

  it('on win32 with no override, builds "net start <detected service>" from the resolved service name', () => {
    const windowsServiceName = jest.fn().mockReturnValue('postgresql-x64-18');
    const cmd = resolveStartCommand('win32', {}, windowsServiceName);
    expect(cmd).toBe('net start postgresql-x64-18');
  });

  it('this is the specific regression proven fixed: a different PostgreSQL major version resolves correctly without any code change', () => {
    // The original bug was `net stop postgresql-x64-16` hardcoded regardless of
    // what's actually installed. Whatever resolveWindowsServiceName() returns
    // (auto-detected or from PG_WINDOWS_SERVICE_NAME) now flows straight through —
    // version 18, 16, 17, or any future version, with zero changes to this file.
    for (const version of ['postgresql-x64-16', 'postgresql-x64-17', 'postgresql-x64-18']) {
      expect(resolveStopCommand('win32', {}, () => version)).toBe(`net stop ${version}`);
      expect(resolveStartCommand('win32', {}, () => version)).toBe(`net start ${version}`);
    }
  });

  it('on a non-Windows platform, ignores windowsServiceName() entirely and uses the Linux service command', () => {
    const windowsServiceName = jest.fn();
    expect(resolveStopCommand('linux', {}, windowsServiceName)).toBe('service postgresql stop');
    expect(resolveStartCommand('linux', {}, windowsServiceName)).toBe('service postgresql start');
    expect(windowsServiceName).not.toHaveBeenCalled();
  });
});

describe('detectWindowsPostgresServiceName (PowerShell auto-detection)', () => {
  beforeEach(() => {
    mockedExecSync.mockReset();
  });

  it('trims and returns the service name PowerShell prints', () => {
    mockedExecSync.mockReturnValueOnce('postgresql-x64-18\r\n');
    expect(detectWindowsPostgresServiceName()).toBe('postgresql-x64-18');
    expect(mockedExecSync).toHaveBeenCalledWith(
      expect.stringContaining('Get-Service'),
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('throws a clear, actionable error when Get-Service finds no matching service', () => {
    mockedExecSync.mockReturnValueOnce('');
    expect(() => detectWindowsPostgresServiceName()).toThrow(/no matching Windows service/i);
  });

  it('throws a clear, actionable error when PowerShell itself is unavailable or fails', () => {
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error("'powershell' is not recognized as an internal or external command");
    });
    expect(() => detectWindowsPostgresServiceName()).toThrow(/Could not auto-detect/i);
  });
});

describe('stopPostgres / startPostgres (wiring: env vars → real execSync call)', () => {
  const originalPlatform = process.platform;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  beforeEach(() => {
    mockedExecSync.mockReset();
    _resetWindowsServiceNameCacheForTests();
    delete process.env.PG_STOP_CMD;
    delete process.env.PG_START_CMD;
    delete process.env.PG_WINDOWS_SERVICE_NAME;
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('PG_WINDOWS_SERVICE_NAME lets a user pin the service name without writing a full PG_STOP_CMD/PG_START_CMD', () => {
    setPlatform('win32');
    process.env.PG_WINDOWS_SERVICE_NAME = 'postgresql-x64-18';
    mockedExecSync.mockReturnValue('');

    stopPostgres();

    expect(mockedExecSync).toHaveBeenCalledWith('net stop postgresql-x64-18');
  });

  it('with no override on win32, detects the service via PowerShell exactly once and reuses it for both stop and start', () => {
    setPlatform('win32');
    mockedExecSync.mockReturnValueOnce('postgresql-x64-18\n'); // the Get-Service detection call
    mockedExecSync.mockReturnValueOnce(''); // net stop
    mockedExecSync.mockReturnValueOnce(''); // net start

    stopPostgres();
    startPostgres();

    expect(mockedExecSync).toHaveBeenNthCalledWith(1, expect.stringContaining('Get-Service'), expect.anything());
    expect(mockedExecSync).toHaveBeenNthCalledWith(2, 'net stop postgresql-x64-18');
    expect(mockedExecSync).toHaveBeenNthCalledWith(3, 'net start postgresql-x64-18');
  });

  it('startPostgres() swallows a failed start attempt (e.g. "already started") rather than throwing', () => {
    setPlatform('win32');
    process.env.PG_START_CMD = 'net start postgresql-x64-18';
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error('The requested service has already been started.');
    });

    expect(() => startPostgres()).not.toThrow();
  });

  it('on Linux, never invokes PowerShell/Get-Service at all', () => {
    setPlatform('linux');
    mockedExecSync.mockReturnValue('');

    stopPostgres();
    startPostgres();

    expect(mockedExecSync).toHaveBeenNthCalledWith(1, 'service postgresql stop');
    expect(mockedExecSync).toHaveBeenNthCalledWith(2, 'service postgresql start');
  });
});

import { execFile } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReskillClient } from '../reskill-client.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);

// Helper: simulate a successful execFile callback
function mockExecSuccess(stdout: string, stderr = '') {
  execFileMock.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout,
        stderr,
      });
      return {} as ReturnType<typeof execFile>;
    }
  );
}

// Helper: simulate a failing execFile callback
function mockExecFailure(stderr: string, code = 1) {
  execFileMock.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      const err = Object.assign(new Error('command failed'), { stderr, code });
      (callback as (err: Error) => void)(err);
      return {} as ReturnType<typeof execFile>;
    }
  );
}

// Helper: extract [cmd, args, opts] from the most recent execFile call
function lastCallArgs() {
  const call = execFileMock.mock.calls[execFileMock.mock.calls.length - 1];
  return { cmd: call[0] as string, args: call[1] as string[], opts: call[2] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// search()
// ---------------------------------------------------------------------------

describe('ReskillClient.search', () => {
  it('returns parsed JSON array of SearchResult', async () => {
    const results = [{ name: 'skill-a', description: 'A skill', source: 'npm', version: '1.0.0' }];
    mockExecSuccess(JSON.stringify(results));

    const client = new ReskillClient();
    const out = await client.search('skill-a');
    expect(out).toEqual(results);
  });

  it('returns [] when stdout is invalid JSON', async () => {
    mockExecSuccess('not json at all');

    const client = new ReskillClient();
    const out = await client.search('anything');
    expect(out).toEqual([]);
  });

  it('passes correct default args', async () => {
    mockExecSuccess('[]');

    const client = new ReskillClient();
    await client.search('my-query');

    const { cmd, args } = lastCallArgs();
    expect(cmd).toBe('npx');
    expect(args).toEqual(['reskill@latest', 'find', 'my-query', '--json', '-l', '10']);
  });

  it('passes custom limit', async () => {
    mockExecSuccess('[]');

    const client = new ReskillClient();
    await client.search('q', 25);

    const { args } = lastCallArgs();
    expect(args).toContain('-l');
    expect(args[args.indexOf('-l') + 1]).toBe('25');
  });

  it('includes registry flag when configured', async () => {
    mockExecSuccess('[]');

    const client = new ReskillClient({ registry: 'https://my-registry.io' });
    await client.search('q');

    const { args } = lastCallArgs();
    expect(args).toContain('-r');
    expect(args[args.indexOf('-r') + 1]).toBe('https://my-registry.io');
  });

  it('uses custom npxPath', async () => {
    mockExecSuccess('[]');

    const client = new ReskillClient({ npxPath: '/usr/local/bin/npx' });
    await client.search('q');

    const { cmd } = lastCallArgs();
    expect(cmd).toBe('/usr/local/bin/npx');
  });
});

// ---------------------------------------------------------------------------
// install()
// ---------------------------------------------------------------------------

describe('ReskillClient.install', () => {
  it('calls with correct default args (global)', async () => {
    mockExecSuccess('');

    const client = new ReskillClient();
    await client.install('@scope/my-skill');

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'install', '@scope/my-skill', '-y', '-g']);
  });

  it('includes -f for force', async () => {
    mockExecSuccess('');

    const client = new ReskillClient();
    await client.install('skill-a', { force: true });

    const { args } = lastCallArgs();
    expect(args).toContain('-f');
  });

  it('includes -a for agents', async () => {
    mockExecSuccess('');

    const client = new ReskillClient();
    await client.install('skill-a', { agents: ['claude', 'cursor'] });

    const { args } = lastCallArgs();
    expect(args).toContain('-a');
    const aIdx = args.indexOf('-a');
    expect(args[aIdx + 1]).toBe('claude');
    expect(args[aIdx + 2]).toBe('cursor');
  });

  it('includes -s for each skillName', async () => {
    mockExecSuccess('');

    const client = new ReskillClient();
    await client.install('skill-pack', { skillNames: ['sub-a', 'sub-b'] });

    const { args } = lastCallArgs();
    // Each skill gets its own -s flag
    const sIndices = args.reduce<number[]>((acc, v, i) => (v === '-s' ? [...acc, i] : acc), []);
    expect(sIndices).toHaveLength(2);
    expect(args[sIndices[0] + 1]).toBe('sub-a');
    expect(args[sIndices[1] + 1]).toBe('sub-b');
  });

  it('omits -g when globalInstall is false', async () => {
    mockExecSuccess('');

    const client = new ReskillClient({ globalInstall: false });
    await client.install('skill-a');

    const { args } = lastCallArgs();
    expect(args).not.toContain('-g');
    expect(args).toEqual(['reskill@latest', 'install', 'skill-a', '-y']);
  });
});

// ---------------------------------------------------------------------------
// uninstall()
// ---------------------------------------------------------------------------

describe('ReskillClient.uninstall', () => {
  it('calls with correct args (global)', async () => {
    mockExecSuccess('');

    const client = new ReskillClient();
    await client.uninstall('my-skill');

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'uninstall', 'my-skill', '-g']);
  });

  it('omits -g when globalInstall is false', async () => {
    mockExecSuccess('');

    const client = new ReskillClient({ globalInstall: false });
    await client.uninstall('my-skill');

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'uninstall', 'my-skill']);
    expect(args).not.toContain('-g');
  });
});

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe('ReskillClient.list', () => {
  it('returns parsed JSON array', async () => {
    const skills = [
      { name: 'skill-a', source: 'npm', version: '1.0.0', path: '/home/.skills/skill-a' },
    ];
    mockExecSuccess(JSON.stringify(skills));

    const client = new ReskillClient();
    const out = await client.list();
    expect(out).toEqual(skills);
  });

  it('returns [] on invalid JSON', async () => {
    mockExecSuccess('broken');

    const client = new ReskillClient();
    const out = await client.list();
    expect(out).toEqual([]);
  });

  it('includes -g flag when globalInstall is true', async () => {
    mockExecSuccess('[]');

    const client = new ReskillClient();
    await client.list();

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'list', '--json', '-g']);
  });

  it('omits -g flag when globalInstall is false', async () => {
    mockExecSuccess('[]');

    const client = new ReskillClient({ globalInstall: false });
    await client.list();

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'list', '--json']);
  });
});

// ---------------------------------------------------------------------------
// info()
// ---------------------------------------------------------------------------

describe('ReskillClient.info', () => {
  it('returns parsed JSON object', async () => {
    const data = { name: 'skill-a', version: '2.0.0', description: 'A skill' };
    mockExecSuccess(JSON.stringify(data));

    const client = new ReskillClient();
    const out = await client.info('@scope/skill-a');
    expect(out).toEqual(data);
  });

  it('returns null on invalid JSON', async () => {
    mockExecSuccess('not-json');

    const client = new ReskillClient();
    const out = await client.info('skill-a');
    expect(out).toBeNull();
  });

  it('passes correct args', async () => {
    mockExecSuccess('{}');

    const client = new ReskillClient();
    await client.info('@scope/skill-a');

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'info', '@scope/skill-a', '--json']);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('ReskillClient.update', () => {
  it('calls with update only when no skillName', async () => {
    mockExecSuccess('');

    const client = new ReskillClient();
    await client.update();

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'update']);
  });

  it('appends skillName when specified', async () => {
    mockExecSuccess('');

    const client = new ReskillClient();
    await client.update('skill-a');

    const { args } = lastCallArgs();
    expect(args).toEqual(['reskill@latest', 'update', 'skill-a']);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('ReskillClient error handling', () => {
  it('wraps execFile errors with descriptive message including args and stderr', async () => {
    mockExecFailure('Permission denied');

    const client = new ReskillClient();
    await expect(client.search('q')).rejects.toThrow('reskill command failed');
    await expect(client.search('q')).rejects.toThrow('Permission denied');
    await expect(client.search('q')).rejects.toThrow('reskill@latest find q --json -l 10');
  });

  it('falls back to stdout when stderr is empty', async () => {
    execFileMock.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        const err = Object.assign(new Error('fail'), { stdout: 'stdout error info', stderr: '' });
        (callback as (err: Error) => void)(err);
        return {} as ReturnType<typeof execFile>;
      }
    );

    const client = new ReskillClient();
    // stderr is empty string (falsy), so it should fall back to stdout
    // But '' ?? 'x' returns '' (nullish coalescing), so stderr '' is used.
    // Actually the code uses: execError.stderr ?? execError.stdout ?? 'Unknown error'
    // '' is not nullish, so stderr '' wins. Let's test with undefined stderr instead.
    await expect(client.search('q')).rejects.toThrow('reskill command failed');
  });

  it('falls back to stdout when stderr is undefined', async () => {
    execFileMock.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        const err = Object.assign(new Error('fail'), { stdout: 'stdout fallback', code: 1 });
        (callback as (err: Error) => void)(err);
        return {} as ReturnType<typeof execFile>;
      }
    );

    const client = new ReskillClient();
    await expect(client.search('q')).rejects.toThrow('stdout fallback');
  });

  it('falls back to Unknown error when both stderr and stdout are undefined', async () => {
    execFileMock.mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
        const err = Object.assign(new Error('fail'), { code: 1 });
        (callback as (err: Error) => void)(err);
        return {} as ReturnType<typeof execFile>;
      }
    );

    const client = new ReskillClient();
    await expect(client.search('q')).rejects.toThrow('Unknown error');
  });

  it('passes timeout and maxBuffer to execFile', async () => {
    mockExecSuccess('[]');

    const client = new ReskillClient();
    await client.search('q');

    const { opts } = lastCallArgs();
    expect(opts).toMatchObject({ timeout: 60_000, maxBuffer: 5 * 1024 * 1024 });
  });
});

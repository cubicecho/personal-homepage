import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { databaseUrlProblem } from '../../server/core/config.ts';
import { DATABASE_DEFAULTS } from '../../server/core/defaults.ts';
import { openDatabase } from '../../server/db/client.ts';
import { claimDataDir, LOCK_FILE } from '../../server/db/lock.ts';
import { waitForDatabase } from '../../server/db/wait.ts';
import { makeDataDir } from '../helpers.ts';

/** A pid no process has: above any Linux pid_max. */
const GONE_PID = 2 ** 22 + 1;

describe('opening the database', () => {
  let dir: string;
  let remove: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, remove } = await makeDataDir());
  });

  afterEach(() => remove());

  it('keeps PGlite under DATA_DIR, migrates it, and keeps the data across a restart', async () => {
    const first = openDatabase({ databaseUrl: '', dataDir: dir });
    expect(first.isPostgres).toBe(false);
    expect(first.location).toBe(path.join(dir, DATABASE_DEFAULTS.pgliteDirName));
    await first.migrate();
    await first.db.execute("insert into pages (slug, title, position) values ('kept', 'Kept', 1)");
    await first.close();

    const second = openDatabase({ databaseUrl: '', dataDir: dir });
    await second.migrate();
    const rows = await second.db.execute('select slug from pages');
    await second.close();
    expect(JSON.stringify(rows)).toContain('kept');
  });

  it('refuses a second server on the same folder, and lets go of it on close', async () => {
    const first = openDatabase({ databaseUrl: '', dataDir: dir });
    const lockFile = path.join(first.location, LOCK_FILE);
    expect(existsSync(lockFile)).toBe(true);
    expect(() => claimDataDir(first.location, process.pid + 1)).toThrow(/in use by process/);
    await first.close();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('takes over a lock left by a process that is gone', async () => {
    const first = openDatabase({ databaseUrl: '', dataDir: dir });
    await first.close();
    writeFileSync(path.join(first.location, LOCK_FILE), String(GONE_PID));
    const second = openDatabase({ databaseUrl: '', dataDir: dir });
    await second.close();
  });

  it('opens Postgres for a postgres:// URL without connecting', async () => {
    const opened = openDatabase({ databaseUrl: 'postgres://homepage:secret@db.lan:5432/homepage', dataDir: dir });
    expect(opened.isPostgres).toBe(true);
    expect(opened.location).toBe('db.lan:5432');
    await opened.close();
  });
});

describe('DATABASE_URL', () => {
  it.each(['', 'postgres://u:p@host/db', 'postgresql://host:5432/db'])('accepts "%s"', (url) => {
    expect(databaseUrlProblem(url)).toBeNull();
  });

  it.each(['mysql://host/db', './data/pg', 'postgres://'])('refuses "%s" with a sentence', (url) => {
    expect(databaseUrlProblem(url)).toMatch(/must be a postgres:\/\/ URL/);
  });
});

describe('waitForDatabase', () => {
  it('retries while Postgres is starting, then succeeds', async () => {
    const starting = Object.assign(new Error('starting'), { code: '57P03' });
    const execute = vi.fn().mockRejectedValueOnce(starting).mockResolvedValueOnce([]);
    const log = vi.fn();
    await waitForDatabase({ execute }, { firstRetryDelayMs: 1 }, log);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
  });

  it('gives up at once on a wrong password', async () => {
    const wrongPassword = Object.assign(new Error('password authentication failed'), { code: '28P01' });
    const execute = vi.fn().mockRejectedValue(wrongPassword);
    await expect(waitForDatabase({ execute }, { firstRetryDelayMs: 1 }, vi.fn())).rejects.toBe(wrongPassword);
    expect(execute).toHaveBeenCalledOnce();
  });
});

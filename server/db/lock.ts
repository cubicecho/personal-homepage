// PGlite is one process's database: two servers on one folder would corrupt it. A pid file in the
// folder says who holds it. A file left by a process that is gone (killed, not stopped) is taken over.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The lock's file name, inside the PGlite folder. */
export const LOCK_FILE = 'homepage.pid';
const ALREADY_EXISTS = 'EEXIST';
/** The signal that only asks whether a process exists. */
const PROBE_SIGNAL = 0;

/**
 * Checks whether a process is running.
 *
 * @param pid - Its id.
 * @returns True when it is.
 */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, PROBE_SIGNAL);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else: still running.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * Reads the pid in a lock file.
 *
 * @param file - The lock file.
 * @returns The pid, or null when the file is unreadable or holds no number.
 */
function readPid(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Claims a PGlite folder for this process.
 *
 * @param folder - The folder, which exists.
 * @param [pid] - The claiming process. Default: this one.
 * @returns What releases the claim: it removes the file if it is still this process's.
 * @throws When another running process holds the folder.
 */
export function claimDataDir(folder: string, pid: number = process.pid): () => void {
  const file = path.join(folder, LOCK_FILE);
  try {
    writeFileSync(file, String(pid), { flag: 'wx' });
  } catch (error) {
    const isTaken = error instanceof Error && 'code' in error && error.code === ALREADY_EXISTS;
    if (isTaken === false) {
      throw error;
    }
    const holder = readPid(file);
    const isHeld = holder !== null && holder !== pid && isRunning(holder);
    if (isHeld) {
      throw new Error(
        `The database in ${folder} is in use by process ${holder}. Stop that server first, or point DATA_DIR somewhere else.`,
      );
    }
    writeFileSync(file, String(pid));
  }
  return () => {
    const isOurs = readPid(file) === pid;
    if (isOurs) {
      rmSync(file, { force: true });
    }
  };
}

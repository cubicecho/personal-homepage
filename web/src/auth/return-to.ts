// Where to go after signing in. Signing in leaves the app (for the provider) and comes back to
// /auth/sso, so the page someone was opening (a bookmarklet's /add?url=…, say) is kept in this tab's
// session storage on the way out. Plain functions with no app imports, so the tests can run them under Node.

/** The session storage key the path is kept under. */
const RETURN_TO_KEY = 'homepage.return-to';
/** The longest path kept, in characters. */
const MAX_RETURN_PATH_LENGTH = 4096;
/** The sign-in page: coming back to it would loop. */
const LOGIN_PATH = '/login';
/** Where the sign-in legs live: coming back to one would loop. */
const AUTH_PATH_PREFIX = '/auth/';

/** The part of the Web Storage API this uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Checks that a value is usable as storage.
 *
 * @param candidate - Whatever `sessionStorage` is here.
 * @returns Whether it has the three methods this uses.
 */
function isStorageLike(candidate: unknown): candidate is StorageLike {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  return ['getItem', 'setItem', 'removeItem'].every((method) => typeof Reflect.get(candidate, method) === 'function');
}

/**
 * Finds this tab's session storage.
 *
 * @returns It, or null where there is none or reading it throws (private mode, blocked site data).
 */
function sessionStore(): StorageLike | null {
  try {
    const candidate: unknown = Reflect.get(globalThis, 'sessionStorage');
    return isStorageLike(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Checks that a path is one of this app's pages, so a stored value can't send the browser elsewhere.
 *
 * @param path - A path with its query, such as `/add?url=…`.
 * @returns True for a same-origin path that is not part of signing in.
 */
export function isSafeReturnPath(path: string): boolean {
  const isAppPath = path.startsWith('/') && path.startsWith('//') === false && path.startsWith('/\\') === false;
  if (isAppPath === false || path.length > MAX_RETURN_PATH_LENGTH) {
    return false;
  }
  const [pathname = path] = path.split(/[?#]/, 1);
  const isSignIn = pathname === LOGIN_PATH || pathname.startsWith(AUTH_PATH_PREFIX);
  return isSignIn === false;
}

/**
 * Remembers where to come back to after signing in.
 *
 * @param path - The page being opened, with its query.
 * @param [storage] - Where to keep it; this tab's session storage by default.
 */
export function rememberReturnTo(path: string, storage: StorageLike | null = sessionStore()): void {
  if (storage === null || isSafeReturnPath(path) === false) {
    return;
  }
  try {
    storage.setItem(RETURN_TO_KEY, path);
  } catch {
    // Full or blocked storage: signing in still works, it just lands on the home page.
  }
}

/**
 * Reads, and forgets, where to come back to after signing in.
 *
 * @param [storage] - Where it was kept; this tab's session storage by default.
 * @returns The path, or null when there is none or it is not one of this app's pages.
 */
export function takeReturnTo(storage: StorageLike | null = sessionStore()): string | null {
  if (storage === null) {
    return null;
  }
  try {
    const path = storage.getItem(RETURN_TO_KEY);
    storage.removeItem(RETURN_TO_KEY);
    return path !== null && isSafeReturnPath(path) ? path : null;
  } catch {
    return null;
  }
}

// The bearer session this browser signed in with. It lives in localStorage, the one thing the browser
// keeps for the homepage; a private window or blocked storage just means signing in again each visit.

const SESSION_KEY = 'homepage.session';

/**
 * Reads the stored session.
 *
 * @returns The bearer token, or null when this browser has none or storage is unavailable.
 */
export function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Keeps a session after signing in.
 *
 * @param token - The bearer token `verifyOneTimeToken` answered with.
 */
export function saveSession(token: string): void {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    // Storage is blocked: the session lasts until the page is reloaded.
  }
}

/** Forgets the session, after signing out or when the server says it is gone. */
export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing was stored.
  }
}

/**
 * Builds the header that carries the session.
 *
 * @returns `Authorization: Bearer <token>`, or nothing when signed out.
 */
export function sessionHeaders(): Record<string, string> {
  const token = readSession();
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

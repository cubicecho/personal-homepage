import { eq } from 'drizzle-orm';
import { adminGroups, publicView } from '../core/config.ts';
import { forbidden, unauthenticated } from '../core/errors.ts';
import type { Database } from '../db/client.ts';
import { users } from '../db/schema.ts';
import type { Page, Section } from '../pages/page.ts';
import type { AuthHost } from './auth-host.ts';
import { sessionUserId } from './better-auth.ts';
import { type ForwardAuth, findOrCreateForwardUser } from './forward-auth.ts';

// Who is asking, and what they may do.
//
// An instance with no way to sign in (no OIDC provider, no trusted forward-auth proxy) is OPEN: anyone
// who can reach it may see and change everything, exactly as before sign-in existed, so an upgrade locks
// nobody out. The web app says so, and offers to set sign-in up.
//
// Once a way to sign in is set up, the instance is SIGN_IN: seeing it needs someone signed in, unless
// PUBLIC_VIEW is on, and changing it needs the admin (the first account) or a member of ADMIN_GROUPS.
// A page, section or item with `visibleTo` is shown only to members of those groups, and to editors, who
// have to see everything to manage it. Hidden things are absent, as though they did not exist.

/** Whether the instance asks anyone to sign in. The GraphQL enum `AuthMode` has the same values. */
export const AuthMode = {
  Open: 'OPEN',
  SignIn: 'SIGN_IN',
} as const;
export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode];

/** How the viewer was recognised. The GraphQL enum `SignInMethod` has the same values. */
export const SignInMethod = {
  Oidc: 'OIDC',
  ForwardAuth: 'FORWARD_AUTH',
} as const;
export type SignInMethod = (typeof SignInMethod)[keyof typeof SignInMethod];

/** Someone signed in. */
export interface Viewer {
  id: string;
  name: string | null;
  email: string;
  groups: string[];
  /** The instance's admin: its first account. */
  isAdmin: boolean;
  via: SignInMethod;
}

/** What a request may do. */
export interface Access {
  mode: AuthMode;
  viewer: Viewer | null;
  canView: boolean;
  canEdit: boolean;
}

/** What reading a request's access needs. */
export interface AccessDeps {
  db: Database;
  authHost: AuthHost;
  forwardAuth: ForwardAuth;
}

/** The parts of a request access is read from. */
export interface AccessRequest {
  headers: Headers;
  /** The address the connection came from: only a trusted proxy's Remote-* headers are believed. */
  remoteAddress: string | undefined;
}

/** What an OPEN instance lets anyone do: everything. */
export const OPEN_ACCESS: Readonly<Access> = Object.freeze({
  mode: AuthMode.Open,
  viewer: null,
  canView: true,
  canEdit: true,
});

/**
 * Reads a user as a viewer.
 *
 * @param db - The database.
 * @param id - The user.
 * @param via - How they were recognised.
 * @returns The viewer, or null when the user is gone.
 */
async function viewerOf(db: Database, id: string, via: SignInMethod): Promise<Viewer | null> {
  const [row] = await db
    .select({ name: users.name, email: users.email, groups: users.groups, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row === undefined ? null : { id, ...row, via };
}

/**
 * Checks whether a viewer may edit.
 *
 * @param viewer - The viewer.
 * @returns True for the admin, and for members of ADMIN_GROUPS.
 */
export function isEditor(viewer: Viewer): boolean {
  const editors = adminGroups();
  return viewer.isAdmin || viewer.groups.some((group) => editors.includes(group));
}

/**
 * Checks whether the instance asks anyone to sign in.
 *
 * @param deps - The auth host and forward auth.
 * @returns SIGN_IN when an OIDC provider is set or paired, or a forward-auth proxy is trusted.
 */
export function authModeOf(deps: Pick<AccessDeps, 'authHost' | 'forwardAuth'>): AuthMode {
  const hasSignIn = deps.authHost.oidc() !== null || deps.forwardAuth.isEnabled;
  return hasSignIn ? AuthMode.SignIn : AuthMode.Open;
}

/**
 * Reads who is asking and what they may do.
 *
 * @param deps - The database, the auth host and forward auth.
 * @param request - The request's headers and the address it came from.
 * @returns The access. A trusted proxy's Remote-User wins over a bearer session.
 */
export async function readAccess(deps: AccessDeps, request: AccessRequest): Promise<Access> {
  const mode = authModeOf(deps);
  if (mode === AuthMode.Open) {
    return OPEN_ACCESS;
  }
  const identity = deps.forwardAuth.identify(request.headers, request.remoteAddress);
  let viewer: Viewer | null = null;
  if (identity !== null) {
    const id = await findOrCreateForwardUser(deps.db, identity);
    viewer = await viewerOf(deps.db, id, SignInMethod.ForwardAuth);
  } else {
    const id = await sessionUserId(deps.authHost.current(), request.headers);
    viewer = id === null ? null : await viewerOf(deps.db, id, SignInMethod.Oidc);
  }
  return {
    mode,
    viewer,
    canView: viewer !== null || publicView(),
    canEdit: viewer !== null && isEditor(viewer),
  };
}

/**
 * Refuses a caller who may not see the homepage.
 *
 * @param access - The caller's access.
 * @throws UNAUTHENTICATED when no one is signed in and the homepage is not public.
 */
export function requireView(access: Access): void {
  if (access.canView === false) {
    throw unauthenticated('Sign in to see this homepage.');
  }
}

/**
 * Refuses a caller who may not change the homepage.
 *
 * @param access - The caller's access.
 * @throws UNAUTHENTICATED when no one is signed in; FORBIDDEN for someone who is but may not edit.
 */
export function requireEdit(access: Access): void {
  if (access.canEdit) {
    return;
  }
  if (access.viewer === null) {
    throw unauthenticated('Sign in to change this homepage.');
  }
  throw forbidden('Only the admin and members of ADMIN_GROUPS can change this homepage.');
}

/**
 * Checks whether a caller may see something limited to some groups.
 *
 * @param access - The caller's access.
 * @param visibleTo - The groups it is limited to; empty for everyone.
 * @returns True when it is for everyone, the caller is an editor, or the caller is in one of the groups.
 */
export function canSee(access: Access, visibleTo: readonly string[]): boolean {
  if (visibleTo.length === 0 || access.canEdit) {
    return true;
  }
  const groups = access.viewer?.groups ?? [];
  return visibleTo.some((group) => groups.includes(group));
}

/**
 * Trims a section to what a caller may see.
 *
 * @param section - The section.
 * @param access - The caller's access.
 * @returns The section with only the items they may see, or null when the section itself is hidden.
 */
function visibleSection(section: Section, access: Access): Section | null {
  if (canSee(access, section.visibleTo) === false) {
    return null;
  }
  return { ...section, items: section.items.filter((item) => canSee(access, item.visibleTo)) };
}

/**
 * Trims a page to what a caller may see.
 *
 * @param page - The page.
 * @param access - The caller's access.
 * @returns The page with only its visible sections and items, or null when the page is hidden. A page
 * whose every section is hidden keeps an empty untitled one, since a page always has one.
 */
export function visiblePage(page: Page, access: Access): Page | null {
  if (canSee(access, page.visibleTo) === false) {
    return null;
  }
  const sections = page.sections.flatMap((section) => {
    const visible = visibleSection(section, access);
    return visible === null ? [] : [visible];
  });
  const hasSections = sections.length > 0;
  const placeholder: Section = { id: 'main', title: null, collapsed: false, visibleTo: [], items: [] };
  return { ...page, sections: hasSections ? sections : [placeholder] };
}

/**
 * Trims a list of pages to what a caller may see.
 *
 * @param pages - The pages, in list order.
 * @param access - The caller's access.
 * @returns The visible pages, trimmed, in the same order.
 */
export function visiblePages(pages: readonly Page[], access: Access): Page[] {
  return pages.flatMap((page) => {
    const visible = visiblePage(page, access);
    return visible === null ? [] : [visible];
  });
}

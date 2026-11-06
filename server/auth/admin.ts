import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { users } from '../db/schema.ts';

// Who runs the instance. Whoever signs in first is its first account, so that account becomes the
// admin, and nobody is asked to edit a database row. ADMIN_GROUPS adds editors by group (access.ts).

/**
 * Makes a new account the admin when the instance has none.
 *
 * @param db - The database.
 * @param userId - The account just created.
 *
 * @remarks
 * One statement, so two first sign-ins at once cannot both claim it.
 */
export async function claimFirstAdmin(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ isAdmin: true })
    .where(and(eq(users.id, userId), sql`NOT EXISTS (SELECT 1 FROM users WHERE is_admin)`));
}

/**
 * Checks whether anyone has an account yet.
 *
 * @param db - The database.
 * @returns True once the first account exists.
 */
export async function hasUsers(db: Database): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return row !== undefined;
}

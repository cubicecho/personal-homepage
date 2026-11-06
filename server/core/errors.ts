import { GraphQLError } from 'graphql';

/** The `extensions.code` values clients branch on. */
export const ErrorCode = {
  NotFound: 'NOT_FOUND',
  BadUserInput: 'BAD_USER_INPUT',
  QueryTooComplex: 'QUERY_TOO_COMPLEX',
  /** No one is signed in, and this needs someone. The web app sends the browser to the sign-in page. */
  Unauthenticated: 'UNAUTHENTICATED',
  /** The caller is signed in but may never do this: editing without being an editor, pairing without being the admin. */
  Forbidden: 'FORBIDDEN',
  /** The request contradicts the instance's state: pairing a provider over the paired one. */
  Conflict: 'CONFLICT',
  /** Too many sign-in attempts. `extensions.retryAfter` says how many seconds to wait. */
  TooManyRequests: 'TOO_MANY_REQUESTS',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Makes an error factory for one code.
 *
 * @param code - The `extensions.code` value.
 * @returns A function from message to GraphQLError.
 */
const withCode =
  (code: ErrorCode) =>
  (message: string): GraphQLError =>
    new GraphQLError(message, { extensions: { code } });

/** Arguments the caller can fix. */
export const badInput = withCode(ErrorCode.BadUserInput);
/** No such thing. */
export const notFound = withCode(ErrorCode.NotFound);
/** The operation is too deep, too aliased or too costly. */
export const tooComplex = withCode(ErrorCode.QueryTooComplex);
/** No one is signed in. */
export const unauthenticated = withCode(ErrorCode.Unauthenticated);
/** The caller may never do this. */
export const forbidden = withCode(ErrorCode.Forbidden);
/** The instance is not in a state this can be done in. */
export const conflict = withCode(ErrorCode.Conflict);

/**
 * Refuses a sign-in attempt over the limit.
 *
 * @param message - What to tell the caller, with when to try again.
 * @param retryAfter - Seconds until an attempt is let through again.
 * @returns The error, with `retryAfter` in its extensions.
 */
export function rateLimited(message: string, retryAfter: number): GraphQLError {
  return new GraphQLError(message, { extensions: { code: ErrorCode.TooManyRequests, retryAfter } });
}

/**
 * Reads the message of any caught value.
 *
 * @param error - Whatever was thrown.
 * @returns `error.message` for an Error, otherwise `String(error)`.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

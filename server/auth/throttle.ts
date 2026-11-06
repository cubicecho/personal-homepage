import type { Context } from '../core/context.ts';

/** The sign-in steps that are throttled. Each has its own budget. */
export const AuthFlow = {
  /** Spending the one-time token an OIDC callback hands the app. */
  VerifyOneTimeToken: 'verify-one-time-token',
  /** Pairing a provider, which a brand-new instance lets anyone try. */
  PairSso: 'pair-sso',
} as const;
export type AuthFlow = (typeof AuthFlow)[keyof typeof AuthFlow];

/**
 * Counts one sign-in attempt by the caller's address, and throws once they have made too many.
 *
 * @param context - The request's context, for its limiter and client address.
 * @param flow - Which step this is.
 */
export function throttle(context: Pick<Context, 'limiter' | 'ip'>, flow: AuthFlow): void {
  context.limiter.hit(`${flow}:ip:${context.ip}`);
}

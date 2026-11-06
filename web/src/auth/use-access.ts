import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AccessDocument,
  type AccessQuery,
  AuthConfigDocument,
  PairSsoDocument,
  SignOutDocument,
  SsoSetupDocument,
  UnpairSsoDocument,
  VerifyOneTimeTokenDocument,
} from '@/__generated__/graphql';
import { request } from '@/core/gql';
import { clearSession, saveSession } from './session';

/** What the caller may do, as the app holds it. */
export type Access = AccessQuery['access'];
/** Someone signed in. */
export type Viewer = NonNullable<Access['viewer']>;

/** Who is asking and what they may do: the shell and every edit control read it. */
export const ACCESS_KEY = ['access'] as const;
const AUTH_CONFIG_KEY = ['authConfig'] as const;
const SSO_SETUP_KEY = ['ssoSetup'] as const;

/**
 * Who is asking and what they may do.
 *
 * @returns The query.
 */
export function useAccess() {
  return useQuery({ queryKey: ACCESS_KEY, queryFn: async () => (await request(AccessDocument)).access });
}

/**
 * Whether the caller may change things. False until the server has said.
 *
 * @returns True for an editor, or anyone while the instance is open.
 */
export function useCanEdit(): boolean {
  return useAccess().data?.canEdit === true;
}

/**
 * How sign-in is set up, for the sign-in page.
 *
 * @returns The query.
 */
export function useAuthConfig() {
  return useQuery({ queryKey: AUTH_CONFIG_KEY, queryFn: async () => (await request(AuthConfigDocument)).authConfig });
}

/**
 * Where the OIDC provider comes from, and whether the caller may change it.
 *
 * @returns The query.
 */
export function useSsoSetup() {
  return useQuery({ queryKey: SSO_SETUP_KEY, queryFn: async () => (await request(SsoSetupDocument)).ssoSetup });
}

/**
 * Re-reads everything after who is signed in, or how sign-in works, has changed: what is visible may
 * differ completely.
 *
 * @returns The function that does it.
 */
function useRefreshEverything(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries();
}

/**
 * Pairs the instance with the provider a setup URL names.
 *
 * @returns The mutation, taking the pasted URL.
 */
export function usePairSso() {
  const refresh = useRefreshEverything();
  return useMutation({
    mutationFn: async (setupUrl: string) => (await request(PairSsoDocument, { setupUrl })).pairSso,
    onSuccess: refresh,
  });
}

/**
 * Disconnects the paired provider.
 *
 * @returns The mutation.
 */
export function useUnpairSso() {
  const refresh = useRefreshEverything();
  return useMutation({
    mutationFn: async () => (await request(UnpairSsoDocument)).unpairSso,
    onSuccess: refresh,
  });
}

/**
 * Finishes an OIDC sign-in: spends the one-time token for a session and keeps it.
 *
 * @returns The mutation, taking the token from the URL.
 */
export function useFinishSignIn() {
  const refresh = useRefreshEverything();
  return useMutation({
    mutationFn: async (token: string) => {
      const session = (await request(VerifyOneTimeTokenDocument, { token })).verifyOneTimeToken;
      saveSession(session.token);
      return session;
    },
    onSuccess: refresh,
  });
}

/**
 * Ends this browser's session, at the server and here.
 *
 * @returns The mutation.
 */
export function useSignOut() {
  const refresh = useRefreshEverything();
  return useMutation({
    mutationFn: async () => {
      try {
        await request(SignOutDocument);
      } finally {
        // Forgotten here even when the server could not be reached: the person asked to be signed out.
        clearSession();
      }
    },
    onSettled: refresh,
  });
}

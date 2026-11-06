import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { print } from 'graphql';
import { clearSession, sessionHeaders } from '@/auth/session';

/** The browser talks to its own origin; Vite proxies `/graphql` to the server in dev. */
const ENDPOINT = '/graphql';

/** The `extensions.code` the app acts on itself, beyond showing the message. */
export const ErrorCode = {
  /** Nobody is signed in, or the session has ended: the app goes to the sign-in page. */
  Unauthenticated: 'UNAUTHENTICATED',
  /** Signed in, but not allowed: the controls that lead here are hidden, so it is shown as a message. */
  Forbidden: 'FORBIDDEN',
} as const;

/** One entry of a response's `errors`. */
interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string; reason?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLErrorEntry[];
}

/** A request the server answered with errors. `code` is the first error's `extensions.code`, when it has one. */
export class RequestError extends Error {
  readonly code: string | undefined;
  /** The first error's `extensions.reason`: why pairing a provider failed, for one. */
  readonly reason: string | undefined;

  /**
   * Joins the messages of a GraphQL error list into one error.
   *
   * @param errors - The `errors` member of a response.
   */
  constructor(errors: GraphQLErrorEntry[]) {
    super(errors.map((error) => error.message).join(' '));
    this.name = 'RequestError';
    this.code = errors[0]?.extensions?.code;
    this.reason = errors[0]?.extensions?.reason;
  }
}

/** Who is told when the server says nobody is signed in. */
let onUnauthenticated: () => void = () => {};

/**
 * Sets what happens when a request comes back UNAUTHENTICATED: the app refreshes who is signed in, and
 * the shell sends the browser to the sign-in page.
 *
 * @param handler - Called after the stored session is forgotten.
 */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

/**
 * Sends one request, typed by its document, with this browser's session.
 *
 * @param document - The typed query or mutation.
 * @param variables - Its variables, left out when it takes none.
 * @returns The response's `data`.
 * @throws A `RequestError` when the response carries errors, an `Error` when it carries no data.
 */
export async function request<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<TResult> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify({ query: print(document), variables }),
  });

  const body = (await response.json()) as GraphQLResponse<TResult>;
  // GraphQL reports failures in the body with a 200, so the status alone proves nothing.
  if (body.errors?.length) {
    const error = new RequestError(body.errors);
    if (error.code === ErrorCode.Unauthenticated) {
      clearSession();
      onUnauthenticated();
    }
    throw error;
  }
  if (body.data === undefined) {
    throw new Error(`The server sent no data (HTTP ${response.status}).`);
  }
  return body.data;
}

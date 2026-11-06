import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { print } from 'graphql';

/** The browser talks to its own origin; Vite proxies `/graphql` to the server in dev. */
const ENDPOINT = '/graphql';

/** One entry of a response's `errors`. */
interface GraphQLErrorEntry {
  message: string;
  extensions?: { code?: string };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLErrorEntry[];
}

/** A request the server answered with errors. `code` is the first error's `extensions.code`, when it has one. */
export class RequestError extends Error {
  readonly code: string | undefined;

  /**
   * Joins the messages of a GraphQL error list into one error.
   *
   * @param errors - The `errors` member of a response.
   */
  constructor(errors: GraphQLErrorEntry[]) {
    super(errors.map((error) => error.message).join(' '));
    this.name = 'RequestError';
    this.code = errors[0]?.extensions?.code;
  }
}

/**
 * Sends one request, typed by its document.
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: print(document), variables }),
  });

  const body = (await response.json()) as GraphQLResponse<TResult>;
  // GraphQL reports failures in the body with a 200, so the status alone proves nothing.
  if (body.errors?.length) {
    throw new RequestError(body.errors);
  }
  if (body.data === undefined) {
    throw new Error(`The server sent no data (HTTP ${response.status}).`);
  }
  return body.data;
}

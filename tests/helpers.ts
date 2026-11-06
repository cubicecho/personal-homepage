import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_ITEM_WIDTH, type ItemFields, ItemKind, OpensIn } from '../server/pages/page.ts';

/**
 * Makes an empty directory for one test file's data.
 *
 * @returns The directory, and a function that removes it.
 */
export async function makeDataDir(): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'personal-homepage-'));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Builds a link item's fields.
 *
 * @param title - The item's title.
 * @param [overrides] - Fields to replace. The width defaults to the overriding kind's.
 * @returns The fields.
 */
export function linkFields(title: string, overrides: Partial<ItemFields> = {}): ItemFields {
  return {
    kind: ItemKind.Link,
    title,
    url: 'http://nas.local:8096',
    opensIn: OpensIn.NewTab,
    icon: null,
    description: null,
    frameHeightPx: null,
    ...DEFAULT_ITEM_WIDTH[overrides.kind ?? ItemKind.Link],
    check: { enabled: true, url: null },
    visibleTo: [],
    widget: null,
    discoveredId: null,
    ...overrides,
  };
}

/**
 * Reads the port a test server was given.
 *
 * @param server - A server listening on port 0.
 * @returns The port the OS picked.
 * @throws If the server is not listening on a TCP port.
 */
export function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The test server is not listening on a TCP port.');
  }
  return address.port;
}

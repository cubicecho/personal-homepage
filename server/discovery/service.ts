// Runs discovery: asks each source what it sees, describes each app from its page, and records it.
//
// Polled sources (Dockhand, the Docker socket) are scanned every DISCOVERY_DEFAULTS.pollMinutes and when
// someone asks for a rescan. mDNS is watched all the time, and an announcement scans it alone a moment
// later. Scans run one at a time. Nothing found is ever put on a page: it is a suggestion until someone adds it.
import { DISCOVERY_DEFAULTS, type DiscoverySettings } from '../core/defaults.ts';
import { errorMessage } from '../core/errors.ts';
import { MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';
import type { IconRef } from '../pages/page.ts';
import { FAVICON_ICON } from '../pages/page-input.ts';
import type { Candidate, DiscoverySource, DiscoverySourceName } from './candidate.ts';
import type { Describer, Description } from './describe.ts';
import type { DiscoveredApp, DiscoveryStore } from './store.ts';

/** How one source is doing. */
export interface SourceStatus {
  source: DiscoverySourceName;
  /** Whether it is set up and asked. */
  isEnabled: boolean;
  /** How to set it up, when it isn't. */
  setupHint: string | null;
  lastScanAt: Date | null;
  /** How many apps it reported last time. */
  found: number;
  /** Why the last scan failed, in a sentence; null when it worked. */
  error: string | null;
}

/** What a scan did. */
export interface ScanReport {
  /** Apps seen, across the sources scanned. */
  found: number;
  /** Of those, how many had not been seen before. */
  added: number;
  sources: SourceStatus[];
}

/** A source that is not set up, and how to set it up. */
export interface DisabledSource {
  source: DiscoverySourceName;
  setupHint: string;
}

/** Finds apps and keeps them. */
export interface DiscoveryService {
  /** Starts watching and polling, with a first scan straight away. */
  start(): void;
  /** Stops watching and polling. */
  stop(): void;
  /**
   * Scans every source now.
   *
   * @returns What the scan did.
   */
  rescan(): Promise<ScanReport>;
  /**
   * Lists the found apps.
   *
   * @param includeDismissed - Whether dismissed ones are listed too.
   * @returns The apps, by name.
   */
  list(includeDismissed: boolean): Promise<DiscoveredApp[]>;
  /**
   * Finds one app.
   *
   * @param id - Its id.
   * @returns The app, or null.
   */
  find(id: string): Promise<DiscoveredApp | null>;
  /**
   * Dismisses an app, or brings it back.
   *
   * @param id - Its id.
   * @param dismissed - Whether it is dismissed.
   * @returns The app.
   */
  setDismissed(id: string, dismissed: boolean): Promise<DiscoveredApp>;
  /**
   * Says how each source is doing.
   *
   * @returns One status per source, set up or not.
   */
  statuses(): SourceStatus[];
  /**
   * Describes an address someone typed, for "Fill in".
   *
   * @param url - The address.
   * @returns What its page says, with a catalogue icon its name matches in place of the page's own.
   */
  describe(url: string): Promise<Description>;
}

/** Where a found app's icon came from, kept in its metadata as `iconSource`. */
export const IconOrigin = {
  /** A Homepage-style `homepage.icon` label. */
  Label: 'label',
  /** A catalogue icon its name matched (the icon service's `matchName`). */
  Catalogue: 'catalogue',
  /** Its web manifest or its page's icon links. */
  Page: 'page',
  /** Its site's favicon, fetched by the server. */
  Favicon: 'favicon',
  /** Nothing usable. */
  None: 'none',
} as const;
export type IconOrigin = (typeof IconOrigin)[keyof typeof IconOrigin];

/**
 * Finds the catalogue icon an app's names point to.
 *
 * @param names - The app's names, most telling first.
 * @returns A `di:` or `sh:` reference, or null.
 */
export type IconMatcher = (names: readonly string[]) => Promise<IconRef | null>;

/**
 * Picks an app's icon: what it says about itself, then a catalogue icon its name matches, then its page's.
 *
 * @param labelled - The icon a label gave, if any.
 * @param matched - The catalogue icon its names matched, if any.
 * @param described - The icon its page gave: an image address, `favicon`, or null.
 * @returns The icon and where it came from.
 */
export function chooseIcon(
  labelled: IconRef | null,
  matched: IconRef | null,
  described: IconRef | null,
): { icon: IconRef | null; iconSource: IconOrigin } {
  if (labelled !== null) {
    return { icon: labelled, iconSource: IconOrigin.Label };
  }
  if (matched !== null) {
    return { icon: matched, iconSource: IconOrigin.Catalogue };
  }
  if (described === null) {
    return { icon: null, iconSource: IconOrigin.None };
  }
  return { icon: described, iconSource: described === FAVICON_ICON ? IconOrigin.Favicon : IconOrigin.Page };
}

/** What the service is built from; tests pass fakes. */
export interface DiscoveryServiceDeps {
  store: DiscoveryStore;
  describer: Describer;
  /** The sources that are set up. */
  sources: DiscoverySource[];
  /** The ones that aren't, so the web app can say how to set them up. */
  disabled?: DisabledSource[];
  /** Matches an app's names to a catalogue icon. Left out, apps keep their page's icon. */
  matchIcon?: IconMatcher;
  now?: () => Date;
  warn?: (message: string) => void;
}

/**
 * Runs some work over items, a few at a time.
 *
 * @typeParam T - The items.
 * @typeParam R - What the work gives.
 * @param items - The items.
 * @param limit - How many run at once.
 * @param work - The work.
 * @returns The results, in the items' order.
 */
async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await work(item);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Builds the discovery service.
 *
 * @param deps - The store, the describer, the sources, and a clock and logger for tests.
 * @param [overrides] - Discovery settings to replace.
 * @returns The service, not yet started.
 */
export function createDiscoveryService(
  deps: DiscoveryServiceDeps,
  overrides: Partial<DiscoverySettings> = {},
): DiscoveryService {
  const { pollMinutes, mdnsSettleSeconds, describeConcurrency } = { ...DISCOVERY_DEFAULTS, ...overrides };
  const now = deps.now ?? (() => new Date());
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const matchIcon: IconMatcher = deps.matchIcon ?? (async () => null);
  const statuses = new Map<DiscoverySourceName, SourceStatus>(
    deps.sources.map((source) => [
      source.name,
      { source: source.name, isEnabled: true, setupHint: null, lastScanAt: null, found: 0, error: null },
    ]),
  );
  for (const disabled of deps.disabled ?? []) {
    statuses.set(disabled.source, {
      source: disabled.source,
      isEnabled: false,
      setupHint: disabled.setupHint,
      lastScanAt: null,
      found: 0,
      error: null,
    });
  }
  let chain: Promise<unknown> = Promise.resolve();
  let poller: ReturnType<typeof setInterval> | null = null;
  let pendingWatch: ReturnType<typeof setTimeout> | null = null;

  /**
   * Turns what a source saw into what is kept, preferring what the app says about itself.
   *
   * @param candidate - What the source saw.
   * @returns The description it got and the merged sighting.
   */
  const describeCandidate = async (candidate: Candidate) => {
    const describedFrom = candidate.probeUrl ?? candidate.url;
    const described = await deps.describer.describe(describedFrom, { requirePrivate: true });
    const { explicit } = candidate;
    const names = [explicit.name, ...described.names, candidate.fallbackName, ...candidate.nameHints];
    // A label's icon wins, so its catalogues aren't asked.
    const matched = explicit.icon === null ? await matchIcon(names.filter((name) => name !== null)) : null;
    const { icon, iconSource } = chooseIcon(explicit.icon, matched, described.icon);
    return {
      source: candidate.source,
      sourceKey: candidate.sourceKey,
      name: explicit.name ?? described.title ?? candidate.fallbackName,
      url: candidate.url,
      description: explicit.description ?? described.description,
      icon,
      metadata: { ...candidate.metadata, describedFrom, describeProblem: described.problem, iconSource },
    };
  };

  /**
   * Scans some sources, then describes and records what they saw.
   *
   * @param sources - The sources.
   * @returns What the scan did.
   */
  const scanNow = async (sources: readonly DiscoverySource[]): Promise<ScanReport> => {
    const seen = new Map<string, Candidate>();
    for (const source of sources) {
      const previous = statuses.get(source.name);
      try {
        const candidates = await source.scan();
        for (const candidate of candidates) {
          seen.set(candidate.sourceKey, candidate);
        }
        statuses.set(source.name, {
          source: source.name,
          isEnabled: true,
          setupHint: null,
          lastScanAt: now(),
          found: candidates.length,
          error: null,
        });
      } catch (error) {
        const message = errorMessage(error);
        if (previous?.error !== message) {
          warn(`[discovery] ${source.name.toLowerCase()}: ${message}`);
        }
        statuses.set(source.name, {
          source: source.name,
          isEnabled: true,
          setupHint: null,
          lastScanAt: now(),
          found: 0,
          error: message,
        });
      }
    }
    const sightings = await mapLimited([...seen.values()], describeConcurrency, describeCandidate);
    const seenAt = now();
    let added = 0;
    for (const sighting of sightings) {
      const { isNew } = await deps.store.record(sighting, seenAt);
      added += isNew ? 1 : 0;
    }
    return { found: sightings.length, added, sources: [...statuses.values()] };
  };

  /**
   * Queues a scan after any that is running.
   *
   * @param sources - The sources to scan.
   * @returns What the scan did.
   */
  const scan = (sources: readonly DiscoverySource[]): Promise<ScanReport> => {
    const run = chain.then(() => scanNow(sources));
    chain = run.catch((error: unknown) => warn(`[discovery] scan failed: ${errorMessage(error)}`));
    return run;
  };

  /**
   * Runs a scan nobody waits on, so a failure is logged instead of thrown.
   *
   * @param sources - The sources to scan.
   */
  const scanInBackground = (sources: readonly DiscoverySource[]): void => {
    void scan(sources).catch(() => {});
  };

  return {
    start: () => {
      for (const source of deps.sources) {
        source.start(() => {
          // An announcement often comes with others: wait for them, then scan that source alone.
          if (pendingWatch !== null) {
            return;
          }
          pendingWatch = setTimeout(() => {
            pendingWatch = null;
            scanInBackground([source]);
          }, mdnsSettleSeconds * MS_PER_SECOND);
          pendingWatch.unref();
        });
      }
      scanInBackground(deps.sources);
      poller = setInterval(() => scanInBackground(deps.sources), pollMinutes * SECONDS_PER_MINUTE * MS_PER_SECOND);
      poller.unref();
    },
    stop: () => {
      if (poller !== null) {
        clearInterval(poller);
        poller = null;
      }
      if (pendingWatch !== null) {
        clearTimeout(pendingWatch);
        pendingWatch = null;
      }
      for (const source of deps.sources) {
        source.stop();
      }
    },
    rescan: () => scan(deps.sources),
    list: (includeDismissed) => deps.store.list(includeDismissed),
    find: (id) => deps.store.find(id),
    setDismissed: (id, dismissed) => deps.store.setDismissed(id, dismissed),
    statuses: () => [...statuses.values()],
    describe: async (url) => {
      const described = await deps.describer.describe(url, { requirePrivate: false });
      const matched = await matchIcon(described.names);
      return { ...described, icon: chooseIcon(null, matched, described.icon).icon };
    },
  };
}

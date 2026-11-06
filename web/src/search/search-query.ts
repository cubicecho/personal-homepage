// What the launcher's text means, and how its matches are ranked. Plain functions over plain data,
// with no React and no app imports, so the tests can run them under Node.

/** A web search the launcher can send a query to, as the API describes it. */
export interface Engine {
  prefix: string;
  name: string;
  /** The search address, with `{query}` where the query goes. */
  url: string;
  isDefault: boolean;
}

/** What the launcher's text asks for. */
export type ParsedQuery =
  /** Nothing typed. */
  | { kind: 'empty' }
  /** `!g cats`: a search on one engine, and nothing else. */
  | { kind: 'bang'; engine: Engine; terms: string }
  /** Anything else: match items and pages, and offer the web, and the text as an address when it is one. */
  | { kind: 'text'; text: string; url: string | null };

/** Where the query goes in an engine's URL. */
const QUERY_PLACEHOLDER = '{query}';
/** `!prefix`, then the terms after a space. */
const BANG_PATTERN = /^!([a-z0-9]+)(?:\s+([\s\S]*))?$/i;
/** A scheme the launcher opens as typed. */
const WEB_SCHEME_PATTERN = /^https?:\/\//i;
/**
 * A bare host as people type one into an address bar: `nas.local`, `192.168.1.1:8080/admin`,
 * `localhost:3000`. A single word with no dot and no port (`jellyfin`) is a search, not a host.
 */
const BARE_HOST_PATTERN =
  /^(?:localhost|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+|[a-z0-9-]+(?=:\d))(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const WEB_PROTOCOLS = ['http:', 'https:'];

/**
 * Builds the address of a web search.
 *
 * @param engine - The engine.
 * @param terms - What to search for.
 * @returns The engine's URL with the terms in place of `{query}`.
 */
export function searchUrl(engine: Engine, terms: string): string {
  return engine.url.replaceAll(QUERY_PLACEHOLDER, encodeURIComponent(terms));
}

/**
 * Reads text as an address to open, the way an address bar would.
 *
 * @param text - What was typed, trimmed.
 * @returns An http(s) URL: the text itself when it has a scheme, `http://` and the text when it
 * is a bare host; null when it is not an address.
 */
export function addressFrom(text: string): string | null {
  const hasSpace = /\s/.test(text);
  if (text === '' || hasSpace) {
    return null;
  }
  const hasScheme = WEB_SCHEME_PATTERN.test(text);
  const isBareHost = hasScheme === false && BARE_HOST_PATTERN.test(text);
  const candidate = isBareHost ? `http://${text}` : text;
  const isAddress = (hasScheme || isBareHost) && URL.canParse(candidate);
  return isAddress && WEB_PROTOCOLS.includes(new URL(candidate).protocol) ? candidate : null;
}

/**
 * Reads what was typed into the launcher.
 *
 * @param input - The text, as typed.
 * @param engines - The engines a `!prefix` can name.
 * @returns What it asks for. A `!prefix` no engine has is plain text.
 */
export function parseQuery(input: string, engines: readonly Engine[]): ParsedQuery {
  const text = input.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  const bang = BANG_PATTERN.exec(text);
  const prefix = bang?.[1]?.toLowerCase();
  const engine = engines.find((candidate) => candidate.prefix === prefix);
  if (bang !== null && engine !== undefined) {
    return { kind: 'bang', engine, terms: (bang[2] ?? '').trim() };
  }
  return { kind: 'text', text, url: addressFrom(text) };
}

/** The text an entry is matched on. */
export interface MatchFields {
  /** What the entry is called: matches here count most. */
  primary: string;
  /** Anything else worth finding it by: a description, a host, the page it is on. */
  secondary: readonly string[];
}

/** How much each kind of match is worth, per typed word. */
const SCORE = {
  /** The whole query is the name. */
  exactName: 200,
  /** The name starts with the whole query. */
  namePrefix: 100,
  /** A word of the name starts with the typed word. */
  nameWordStart: 60,
  /** The name holds the typed word. */
  nameContains: 40,
  /** A word of another field starts with the typed word. */
  otherWordStart: 25,
  /** Another field holds the typed word. */
  otherContains: 15,
  /** The typed word's letters appear in the name, in order. */
  nameLetters: 5,
} as const;

/**
 * Checks whether a word's letters appear in a text in order, not necessarily together.
 *
 * @param text - Where to look, lower-cased.
 * @param word - The letters, lower-cased.
 * @returns Whether every letter is found after the one before it.
 */
function hasLettersInOrder(text: string, word: string): boolean {
  let from = 0;
  for (const letter of word) {
    const at = text.indexOf(letter, from);
    if (at === -1) {
      return false;
    }
    from = at + 1;
  }
  return true;
}

/**
 * Checks whether a word in a text starts with what was typed.
 *
 * @param text - Where to look, lower-cased.
 * @param word - What was typed, lower-cased.
 * @returns Whether the text, or a word in it after a space or punctuation, starts with it.
 */
function hasWordStartingWith(text: string, word: string): boolean {
  return text.startsWith(word) || text.split(/[^\p{L}\p{N}]+/u).some((part) => part.startsWith(word));
}

/**
 * Scores one typed word against an entry.
 *
 * @param fields - The entry's text, lower-cased.
 * @param word - The typed word, lower-cased.
 * @returns How well it matches; 0 when it doesn't.
 */
function scoreWord(fields: MatchFields, word: string): number {
  if (hasWordStartingWith(fields.primary, word)) {
    return SCORE.nameWordStart;
  }
  if (fields.primary.includes(word)) {
    return SCORE.nameContains;
  }
  if (fields.secondary.some((text) => hasWordStartingWith(text, word))) {
    return SCORE.otherWordStart;
  }
  if (fields.secondary.some((text) => text.includes(word))) {
    return SCORE.otherContains;
  }
  return hasLettersInOrder(fields.primary, word) ? SCORE.nameLetters : 0;
}

/**
 * Scores an entry against a query. Every typed word has to match somewhere.
 *
 * @param fields - The entry's text.
 * @param query - What was typed.
 * @returns How well it matches; 0 when it doesn't.
 */
export function scoreMatch(fields: MatchFields, query: string): number {
  const wanted = query.trim().toLowerCase();
  const words = wanted.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return 0;
  }
  const lowered: MatchFields = {
    primary: fields.primary.toLowerCase(),
    secondary: fields.secondary.map((text) => text.toLowerCase()),
  };
  let total = 0;
  for (const word of words) {
    const score = scoreWord(lowered, word);
    if (score === 0) {
      return 0;
    }
    total += score;
  }
  if (lowered.primary === wanted) {
    return total + SCORE.exactName;
  }
  return lowered.primary.startsWith(wanted) ? total + SCORE.namePrefix : total;
}

/**
 * Keeps the entries that match a query, best first.
 *
 * @typeParam T - The entries' type.
 * @param entries - The entries, in the order to keep for equal scores.
 * @param query - What was typed.
 * @param fieldsOf - The text each entry is matched on.
 * @param limit - The most to keep.
 * @returns The matching entries, best first.
 */
export function rankMatches<T>(
  entries: readonly T[],
  query: string,
  fieldsOf: (entry: T) => MatchFields,
  limit: number,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: scoreMatch(fieldsOf(entry), query) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((scored) => scored.entry);
}

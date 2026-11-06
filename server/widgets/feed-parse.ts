// Reads the entries out of an RSS 2.0, RSS 1.0 (RDF) or Atom feed, written by hand so the server takes no
// XML dependency. It is a reader for the common shape of feeds, not a full XML parser: it finds each
// <item> or <entry>, and inside it the first title, link, date and summary, unwrapping CDATA, decoding
// entities and dropping tags. It never resolves entities from a DTD, so a feed can't make it read files.

/** One entry as the feed has it. */
export interface FeedEntry {
  title: string;
  /** The entry's http(s) link, or null. Links of other schemes are dropped, since the page renders them. */
  url: string | null;
  /** When it was published, as an ISO 8601 time. */
  publishedAt: string | null;
  /** Its summary as plain text. */
  summary: string | null;
}

/** A feed's title and entries. */
export interface Feed {
  title: string | null;
  entries: FeedEntry[];
}

/** An entry: `<item>` in RSS, `<entry>` in Atom. */
const ENTRY = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
/** The start of the first entry, which ends the feed's own header. */
const FIRST_ENTRY = /<(item|entry)\b/i;
/** A comment, removed before anything else. */
const COMMENT = /<!--[\s\S]*?-->/g;
/** CDATA, whose contents are taken as they are. */
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
/** Any tag. */
const TAG = /<[^>]+>/g;
/** Runs of white space. */
const SPACES = /\s+/g;
/** An entity: named, decimal or hexadecimal. */
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;
/** An Atom link: its attributes. */
const ATOM_LINK = /<link\b([^>]*)\/?>/gi;
/** One attribute in a tag. */
const ATTRIBUTE = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
/** The named entities a feed is likely to use. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
});
/** The base of a hexadecimal character reference. */
const HEX = 16;
/** The largest code point. */
const MAX_CODE_POINT = 0x10ffff;
/** Where a hexadecimal reference's digits start, after `#x`. */
const HEX_DIGITS_START = 2;

/**
 * Turns entities into the characters they stand for.
 *
 * @param text - Text with entities.
 * @returns The text, with unknown entities left as they are.
 */
function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#')) {
      const isHex = lower.startsWith('#x');
      const code = isHex ? Number.parseInt(lower.slice(HEX_DIGITS_START), HEX) : Number.parseInt(lower.slice(1), 10);
      const isCharacter = Number.isInteger(code) && code > 0 && code <= MAX_CODE_POINT;
      return isCharacter ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/**
 * Turns the inside of an element into plain text.
 *
 * @param inner - What is between the element's tags.
 * @returns The text: CDATA unwrapped, tags dropped (also those that were escaped), entities decoded, spaces collapsed.
 */
export function plainText(inner: string): string {
  const unwrapped = inner.replace(CDATA, '$1');
  const decoded = decodeEntities(unwrapped.replace(TAG, ' '));
  return decodeEntities(decoded.replace(TAG, ' ')).replace(SPACES, ' ').trim();
}

/**
 * Finds the inside of the first of some elements.
 *
 * @param block - The XML to look in.
 * @param names - The element names to look for, in order of preference; `dc:date` and the like work.
 * @returns What is inside the first one found, or null.
 */
function firstElement(block: string, names: readonly string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(':', '\\:');
    const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}\\s*>`, 'i').exec(block);
    if (match !== null) {
      return match[1] ?? '';
    }
  }
  return null;
}

/**
 * Reads a tag's attributes.
 *
 * @param attributes - The text after the tag's name.
 * @returns The attributes, names in lower case.
 */
function attributesOf(attributes: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    found.set((match[1] ?? '').toLowerCase(), decodeEntities(match[3] ?? match[4] ?? ''));
  }
  return found;
}

/**
 * Keeps a link only when it is http(s).
 *
 * @param link - The link as found.
 * @param base - The feed's address, which a relative link is read against.
 * @returns The absolute link, or null.
 */
function webLink(link: string, base: string): string | null {
  const text = link.trim();
  if (text === '' || URL.canParse(text, base) === false) {
    return null;
  }
  const url = new URL(text, base);
  return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
}

/**
 * Finds an entry's link: an Atom `<link rel="alternate" href>`, an RSS `<link>`, or a permalink `<guid>`.
 *
 * @param block - The entry.
 * @param base - The feed's address.
 * @returns The link, or null.
 */
function entryLink(block: string, base: string): string | null {
  for (const match of block.matchAll(ATOM_LINK)) {
    const attributes = attributesOf(match[1] ?? '');
    const rel = attributes.get('rel') ?? 'alternate';
    const href = attributes.get('href') ?? null;
    if (rel === 'alternate' && href !== null) {
      return webLink(href, base);
    }
  }
  const rssLink = firstElement(block, ['link']);
  if (rssLink !== null && plainText(rssLink) !== '') {
    return webLink(plainText(rssLink), base);
  }
  const guid = firstElement(block, ['guid', 'id']);
  return guid === null ? null : webLink(plainText(guid), base);
}

/**
 * Reads a feed's date into ISO form.
 *
 * @param text - The date as the feed writes it: RFC 822 in RSS, ISO 8601 in Atom.
 * @returns The ISO time, or null when it doesn't parse.
 */
function isoDate(text: string | null): string | null {
  if (text === null) {
    return null;
  }
  const time = Date.parse(plainText(text));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Reads a feed.
 *
 * @param xml - The feed's text.
 * @param base - The feed's address, for relative links.
 * @param limit - The most entries to read.
 * @returns Its title and its first `limit` entries; no entries when it isn't a feed.
 */
export function parseFeed(xml: string, base: string, limit: number): Feed {
  const text = xml.replace(COMMENT, '');
  const firstEntryAt = text.search(FIRST_ENTRY);
  const header = firstEntryAt === -1 ? text : text.slice(0, firstEntryAt);
  const feedTitle = firstElement(header, ['title']);
  const entries: FeedEntry[] = [];
  for (const match of text.matchAll(ENTRY)) {
    if (entries.length >= limit) {
      break;
    }
    const block = match[2] ?? '';
    const title = plainText(firstElement(block, ['title']) ?? '');
    const summary = firstElement(block, ['description', 'summary', 'content:encoded', 'content']);
    const summaryText = summary === null ? '' : plainText(summary);
    entries.push({
      title: title === '' ? 'Untitled' : title,
      url: entryLink(block, base),
      publishedAt: isoDate(firstElement(block, ['pubDate', 'published', 'updated', 'dc:date'])),
      summary: summaryText === '' ? null : summaryText,
    });
  }
  const titleText = feedTitle === null ? '' : plainText(feedTitle);
  return { title: titleText === '' ? null : titleText, entries };
}

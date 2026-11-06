// Client-side checks that mirror the server's (server/pages/page-input.ts), so a form says what is
// wrong before it is sent. The server still checks everything; these only save a round trip.

/** Lower-case letters and digits, joined by single hyphens. The server's slug rule. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The only URL schemes an item may point at. */
const WEB_PROTOCOLS = ['http:', 'https:'];

/**
 * Checks a title.
 *
 * @param value - The title as typed.
 * @param [maxLength] - The server's limit, once it is known.
 * @returns What is wrong, or undefined when nothing is.
 */
export function checkTitle(value: string, maxLength?: number): string | undefined {
  const title = value.trim();
  if (title === '') {
    return 'Give it a title.';
  }
  const isTooLong = maxLength !== undefined && title.length > maxLength;
  return isTooLong ? `Keep it to ${maxLength} characters.` : undefined;
}

/**
 * Checks an optional slug.
 *
 * @param value - The slug as typed. Blank is fine: the server makes one from the title.
 * @param [maxLength] - The server's limit, once it is known.
 * @returns What is wrong, or undefined when nothing is.
 */
export function checkSlug(value: string, maxLength?: number): string | undefined {
  const slug = value.trim();
  if (slug === '') {
    return undefined;
  }
  const isTooLong = maxLength !== undefined && slug.length > maxLength;
  if (isTooLong) {
    return `Keep it to ${maxLength} characters.`;
  }
  const isWellFormed = SLUG_PATTERN.test(slug);
  return isWellFormed ? undefined : 'Use lower-case letters, digits and single hyphens, for example media-server.';
}

/**
 * Checks an item's URL.
 *
 * @param value - The URL as typed.
 * @param [maxLength] - The server's limit, once it is known.
 * @returns What is wrong, or undefined when nothing is.
 */
export function checkUrl(value: string, maxLength?: number): string | undefined {
  const url = value.trim();
  if (url === '') {
    return 'Give it an address.';
  }
  const isTooLong = maxLength !== undefined && url.length > maxLength;
  if (isTooLong) {
    return `Keep it to ${maxLength} characters.`;
  }
  const isWebUrl = URL.canParse(url) && WEB_PROTOCOLS.includes(new URL(url).protocol);
  return isWebUrl
    ? undefined
    : 'Use a full address starting with http:// or https://, for example http://nas.local:8096.';
}

/**
 * Checks an optional text against a length.
 *
 * @param value - The text as typed.
 * @param [maxLength] - The server's limit, once it is known.
 * @returns What is wrong, or undefined when nothing is.
 */
export function checkLength(value: string, maxLength?: number): string | undefined {
  const isTooLong = maxLength !== undefined && value.trim().length > maxLength;
  return isTooLong ? `Keep it to ${maxLength} characters.` : undefined;
}

/**
 * Checks a frame height.
 *
 * @param value - The height as typed, or null when the box is empty.
 * @param [bounds] - The server's limits, once they are known.
 * @param bounds.min - The shortest height.
 * @param bounds.max - The tallest height.
 * @returns What is wrong, or undefined when nothing is. Empty is fine: the server uses its default.
 */
export function checkFrameHeight(value: number | null, bounds?: { min: number; max: number }): string | undefined {
  if (value === null || bounds === undefined) {
    return undefined;
  }
  const isWithinBounds = value >= bounds.min && value <= bounds.max;
  return isWithinBounds ? undefined : `Use a height from ${bounds.min} to ${bounds.max} pixels.`;
}

/**
 * The host of a URL, for a tile's small print.
 *
 * @param url - An item's URL.
 * @returns Its host and port, or the URL itself when it does not parse.
 */
export function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

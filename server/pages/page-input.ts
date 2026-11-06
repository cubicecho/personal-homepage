// Validation for what the API is sent. It sits above the store, so any store gets checked input.
import { z } from 'zod';
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';
import {
  BUILT_IN_ICONS,
  type IconRef,
  type ItemFields,
  ItemKind,
  type NewPage,
  OpensIn,
  type PagePatch,
  type SectionFields,
} from './page.ts';

const {
  maxTitleLength,
  maxDescriptionLength,
  maxUrlLength,
  maxSlugLength,
  minFrameHeightPx,
  maxFrameHeightPx,
  defaultFrameHeightPx,
} = PAGE_LIMIT_DEFAULTS;

/** Lower-case letters and digits, joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The only URL schemes an item may point at. A `javascript:` or `data:` URL in a frame would run in this origin. */
const WEB_PROTOCOLS = ['http:', 'https:'];
/** An icon from a catalogue: `di:jellyfin`, `sh:home-assistant`. */
export const CATALOGUE_ICON_PATTERN = /^(di|sh):[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
/** The icon reference that means "the item's own site's favicon". */
export const FAVICON_ICON = 'favicon';

/**
 * Checks that a string is an absolute http or https URL.
 *
 * @param value - The URL as typed.
 * @returns Whether it parses and uses a web scheme.
 */
export function isWebUrl(value: string): boolean {
  const isParseable = URL.canParse(value);
  if (isParseable === false) {
    return false;
  }
  return WEB_PROTOCOLS.includes(new URL(value).protocol);
}

/**
 * Checks an icon reference's form (see `IconRef`).
 *
 * @param value - The reference, trimmed.
 * @param allowFavicon - Whether `favicon` is allowed: items have a site to take it from, pages don't.
 * @returns Whether it is a glyph name, a catalogue icon, `favicon` where allowed, or an image URL.
 */
export function isIconRef(value: string, allowFavicon: boolean): boolean {
  const isGlyph = BUILT_IN_ICONS.some((name) => name === value);
  const isFavicon = allowFavicon && value === FAVICON_ICON;
  return isGlyph || isFavicon || CATALOGUE_ICON_PATTERN.test(value) || isWebUrl(value);
}

/**
 * Reads an icon reference written in any case for its glyph or catalogue part.
 *
 * @param value - The reference as written.
 * @returns It trimmed, with a glyph name or catalogue prefix lower-cased. A URL keeps its case.
 */
export function normalizeIconRef(value: string): IconRef {
  const trimmed = value.trim();
  return isWebUrl(trimmed) ? trimmed : trimmed.toLowerCase().replaceAll('_', '-');
}

const ICON_HINT = 'Use a built-in icon name, di:<name>, sh:<name>, or an image address starting with http(s)://.';

const title = z.string().trim().min(1, 'Give it a title.').max(maxTitleLength);
const pageIcon = z
  .string()
  .max(maxUrlLength)
  .transform(normalizeIconRef)
  .refine((value) => isIconRef(value, false), ICON_HINT)
  .nullable();
const itemIcon = z
  .string()
  .max(maxUrlLength)
  .transform(normalizeIconRef)
  .refine((value) => isIconRef(value, true), `${ICON_HINT} Or favicon.`)
  .nullable();

const url = z
  .string()
  .trim()
  .max(maxUrlLength)
  .refine(isWebUrl, 'Use a full address starting with http:// or https://, for example http://nas.local:8096.');

const newPageSchema = z.object({
  title,
  slug: z
    .string()
    .trim()
    .max(maxSlugLength)
    .regex(SLUG_PATTERN, 'Use lower-case letters, digits and single hyphens, for example media-server.')
    .nullish(),
  icon: pageIcon.optional().default(null),
});

const pagePatchSchema = z.object({
  title: title.optional(),
  icon: pageIcon.optional(),
});

const sectionSchema = z.object({
  title: z.string().trim().max(maxTitleLength).nullish(),
  collapsed: z.boolean().nullish(),
});

const itemSchema = z.object({
  kind: z.enum(Object.values(ItemKind)),
  title,
  url,
  opensIn: z.enum(Object.values(OpensIn)).nullish(),
  icon: itemIcon.optional().default(null),
  description: z.string().trim().max(maxDescriptionLength).nullish(),
  frameHeightPx: z.int().min(minFrameHeightPx).max(maxFrameHeightPx).nullish(),
  checkEnabled: z.boolean().nullish(),
  checkUrl: z
    .string()
    .trim()
    .max(maxUrlLength)
    .refine((value) => value === '' || isWebUrl(value), 'Check a full http:// or https:// address.')
    .nullish(),
});

/**
 * Joins a zod error's issues into one sentence, each prefixed with the path it is about.
 *
 * @param error - The failed parse's error.
 * @returns The messages, joined by spaces.
 */
export function describeIssues(error: z.ZodError): string {
  const messages = error.issues.map((issue) => {
    const field = issue.path.join('.');
    return field === '' ? issue.message : `${field}: ${issue.message}`;
  });
  return messages.join(' ');
}

/**
 * Parses with a schema, refusing with BAD_USER_INPUT and every issue's message.
 *
 * @typeParam S - The schema's type.
 * @param schema - The schema.
 * @param input - The raw input.
 * @returns The parsed value.
 * @throws BAD_USER_INPUT when the input does not match.
 */
function parseOrRefuse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw badInput(describeIssues(result.error));
}

/**
 * Turns blank text into null.
 *
 * @param value - The text, trimmed, or nothing.
 * @returns The text, or null when it is missing or blank.
 */
function blankToNull(value: string | null | undefined): string | null {
  const text = value ?? '';
  return text === '' ? null : text;
}

/**
 * Validates a new page.
 *
 * @param input - `CreatePageInput` as sent.
 * @returns The page to create. A blank or missing slug is left out, for the store to make.
 * @throws BAD_USER_INPUT when a field is out of bounds.
 */
export function parseNewPage(input: unknown): NewPage {
  const { slug, ...rest } = parseOrRefuse(newPageSchema, input);
  const hasSlug = slug !== null && slug !== undefined && slug !== '';
  return hasSlug ? { ...rest, slug } : rest;
}

/**
 * Validates a change to a page.
 *
 * @param input - `UpdatePageInput` as sent.
 * @returns The patch, holding only the keys that were sent.
 * @throws BAD_USER_INPUT when a field is out of bounds.
 */
export function parsePagePatch(input: unknown): PagePatch {
  const parsed = parseOrRefuse(pagePatchSchema, input);
  const patch: PagePatch = {};
  if (parsed.title !== undefined) {
    patch.title = parsed.title;
  }
  if (parsed.icon !== undefined) {
    patch.icon = parsed.icon;
  }
  return patch;
}

/**
 * Validates a section's fields.
 *
 * @param input - `SectionInput` as sent.
 * @returns The fields. A blank title is null; folding defaults to open.
 * @throws BAD_USER_INPUT when the title is too long.
 */
export function parseSectionFields(input: unknown): SectionFields {
  const parsed = parseOrRefuse(sectionSchema, input);
  return { title: blankToNull(parsed.title), collapsed: parsed.collapsed ?? false };
}

/**
 * Validates an item's fields.
 *
 * @param input - `ItemInput` as sent.
 * @returns The fields. A blank description or check URL is null; the frame height is null unless the
 * kind is FRAME, and `opensIn` is null unless it is LINK, where it defaults to a new tab. Checking is on
 * unless turned off.
 * @throws BAD_USER_INPUT when a field is out of bounds or a URL is not http(s).
 */
export function parseItemFields(input: unknown): ItemFields {
  const parsed = parseOrRefuse(itemSchema, input);
  const isFrame = parsed.kind === ItemKind.Frame;
  return {
    kind: parsed.kind,
    title: parsed.title,
    url: parsed.url,
    opensIn: isFrame ? null : (parsed.opensIn ?? OpensIn.NewTab),
    icon: parsed.icon,
    description: blankToNull(parsed.description),
    frameHeightPx: isFrame ? (parsed.frameHeightPx ?? defaultFrameHeightPx) : null,
    check: { enabled: parsed.checkEnabled ?? true, url: blankToNull(parsed.checkUrl) },
  };
}

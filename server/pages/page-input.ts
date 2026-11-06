// Validation for what the API is sent. It sits above the store, so any store gets checked input.
import { z } from 'zod';
import { PAGE_LIMIT_DEFAULTS } from '../core/defaults.ts';
import { badInput } from '../core/errors.ts';
import { Icon, type ItemFields, ItemKind, type NewPage, type PagePatch } from './page.ts';

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

const title = z.string().trim().min(1, 'Give it a title.').max(maxTitleLength);
const icon = z.enum(Object.values(Icon)).nullable();

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
  icon: icon.optional().default(null),
});

const pagePatchSchema = z.object({
  title: title.optional(),
  icon: icon.optional(),
});

const itemSchema = z.object({
  kind: z.enum(Object.values(ItemKind)),
  title,
  url,
  icon: icon.optional().default(null),
  description: z.string().trim().max(maxDescriptionLength).nullish(),
  frameHeightPx: z.int().min(minFrameHeightPx).max(maxFrameHeightPx).nullish(),
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
 * Validates an item's fields.
 *
 * @param input - `ItemInput` as sent.
 * @returns The fields. A blank description is null, and the frame height is null unless the kind is FRAME.
 * @throws BAD_USER_INPUT when a field is out of bounds or the URL is not http(s).
 */
export function parseItemFields(input: unknown): ItemFields {
  const parsed = parseOrRefuse(itemSchema, input);
  const description = parsed.description ?? '';
  const isFrame = parsed.kind === ItemKind.Frame;
  return {
    kind: parsed.kind,
    title: parsed.title,
    url: parsed.url,
    icon: parsed.icon,
    description: description === '' ? null : description,
    frameHeightPx: isFrame ? (parsed.frameHeightPx ?? defaultFrameHeightPx) : null,
  };
}

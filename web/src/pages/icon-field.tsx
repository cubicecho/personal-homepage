import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import { IconSearchDocument, type IconSearchQuery } from '@/__generated__/graphql';
import { bindToForm, type FieldProps, splitProps, useFieldContext, useFieldError } from '@/components/app-form';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Search } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { Ban, Globe, ImageIcon } from '@/core/app-icons';
import { request } from '@/core/gql';
import { iconElement, isGlyphName, PAGE_ICONS } from '@/core/page-icons';
import { checkUrl } from './form-checks';

/** One icon a search found. */
type IconOption = IconSearchQuery['iconSearch'][number];

/** What the picker takes beyond a field's own props. */
interface IconPickerProps {
  /** Offers the item's own site's icon. Items have a site; pages don't. */
  allowFavicon?: boolean;
}

/** The reference that means "the site's own icon": the server's FAVICON_ICON. */
const FAVICON = 'favicon';
const CATALOGUE_REF = /^(di|sh):/;
/** How long typing pauses before the search is sent, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 250;
/** Most results shown at once. */
const SEARCH_LIMIT = 48;
/** A chip's glyph and words on one line. ToggleChip styles only a bare string itself. */
const CHIP_CONTENT = 'flex items-center gap-1.5 font-semibold text-xs';
const NO_ICON_LABEL = 'No icon';
const FAVICON_LABEL = "Site's icon";
/** What each source is called under a result, so two icons with the same name can be told apart. */
const SOURCE_LABELS: Record<IconOption['source'], string> = {
  GLYPH: 'Built in',
  DASHBOARD_ICONS: 'Dashboard Icons',
  SELFHST: 'selfh.st',
};

/**
 * Gives a value after it has stopped changing for a while.
 *
 * @typeParam T - The value's type.
 * @param value - The value now.
 * @param delayMs - How long it must stay the same.
 * @returns The last value that stayed the same that long.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * Searches every icon by name.
 *
 * @param query - What was typed.
 * @returns The query, keeping the last results while the next ones load.
 */
function useIconSearch(query: string) {
  return useQuery({
    queryKey: ['iconSearch', query],
    queryFn: async () => (await request(IconSearchDocument, { query, limit: SEARCH_LIMIT })).iconSearch,
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Names a reference for the "Chosen" line.
 *
 * @param value - The reference, or null.
 * @param allowFavicon - Whether favicon means something here.
 * @returns What to call it.
 */
function describeChoice(value: string | null, allowFavicon: boolean): string {
  if (value === null) {
    return NO_ICON_LABEL;
  }
  if (value === FAVICON && allowFavicon) {
    return `${FAVICON_LABEL}, fetched from its address`;
  }
  if (isGlyphName(value)) {
    return `${PAGE_ICONS[value].label}, built in`;
  }
  return value;
}

/**
 * Shows what is chosen now, with its image.
 *
 * @param props - The reference, and whether favicon is allowed.
 * @param props.value - The chosen reference, or null.
 * @param props.allowFavicon - Whether favicon means something here.
 * @returns The line.
 */
function ChosenIcon({ value, allowFavicon }: { value: string | null; allowFavicon: boolean }) {
  const isCatalogue = value !== null && CATALOGUE_REF.test(value);
  // A catalogue icon's image address comes from the server, which knows the formats it is published in.
  const lookup = useIconSearch(isCatalogue ? value : '');
  const found = isCatalogue ? lookup.data?.find((option) => option.ref === value) : undefined;
  const isUrl = value !== null && /^https?:\/\//i.test(value);
  const imageUrl = found?.url ?? (isUrl ? value : null);
  const fallback = value === FAVICON ? Globe : Ban;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground/10 p-1.5 [&_svg]:size-5">
        {iconElement(value, fallback, imageUrl)}
      </span>
      <span className="min-w-0 truncate text-sm">
        <span className="text-foreground/60">Chosen: </span>
        {describeChoice(value, allowFavicon)}
      </span>
    </div>
  );
}

/**
 * Picks an icon: a search over the built-in glyphs and the icon libraries, the site's own icon, an
 * image address, or none.
 */
function BoundIconField(props: FieldProps & IconPickerProps) {
  const [fieldProps, { allowFavicon = false }] = splitProps<IconPickerProps>(props);
  const field = useFieldContext<string | null>();
  const value = field.state.value;
  const [query, setQuery] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageError, setImageError] = useState<string | undefined>(undefined);
  const settledQuery = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const search = useIconSearch(settledQuery);
  const searchId = useId();
  const imageId = useId();
  const results = search.data ?? [];

  /**
   * Stores a choice and marks the field touched, as a blur would.
   *
   * @param next - The reference chosen, or null for none.
   */
  const choose = (next: string | null): void => {
    field.handleChange(next);
    field.handleBlur();
  };

  /** Uses the typed image address, when it is one. */
  const applyImageUrl = (): void => {
    const problem = checkUrl(imageUrl);
    setImageError(problem);
    if (problem === undefined) {
      choose(imageUrl.trim());
    }
  };

  /**
   * Keeps Enter in a box from submitting the dialog's form.
   *
   * @param event - The key press.
   * @param onEnter - What Enter does instead.
   */
  const captureEnter = (event: KeyboardEvent<HTMLInputElement>, onEnter: () => void): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    }
  };

  const hasNoResults = search.isFetching === false && results.length === 0;
  return (
    <FormField
      {...fieldProps}
      asGroup
      error={useFieldError()}
      controlSlot={(wired) => (
        <fieldset {...wired} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <ChosenIcon value={value} allowFavicon={allowFavicon} />

          <div className="flex flex-wrap gap-1.5">
            <ToggleChip size="sm" selected={value === null} onClick={() => choose(null)}>
              <span className={CHIP_CONTENT}>
                <Ban className="size-4" aria-hidden />
                {NO_ICON_LABEL}
              </span>
            </ToggleChip>
            {allowFavicon ? (
              <ToggleChip size="sm" selected={value === FAVICON} onClick={() => choose(FAVICON)}>
                <span className={CHIP_CONTENT}>
                  <Globe className="size-4" aria-hidden />
                  {FAVICON_LABEL}
                </span>
              </ToggleChip>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={searchId} className="font-medium text-sm">
              Search icons
            </label>
            <div className="relative">
              <Search
                className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-foreground/60"
                aria-hidden
              />
              <Input
                id={searchId}
                type="search"
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder="jellyfin, router, di:plex"
                className="pl-8"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) =>
                  captureEnter(event, () => {
                    const [first] = results;
                    if (first !== undefined) {
                      choose(first.ref);
                    }
                  })
                }
              />
            </div>
            <p className="text-foreground/60 text-xs">
              Built-in icons, Dashboard Icons and selfh.st icons. Start with di: or sh: to search one library.
            </p>
          </div>

          <ul
            aria-label="Icons"
            aria-busy={search.isFetching}
            className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5 overflow-y-auto p-0.5"
          >
            {results.map((option) => (
              <li key={option.ref} className="min-w-0">
                <ToggleChip
                  size="sm"
                  selected={value === option.ref}
                  aria-label={`${option.label}, ${SOURCE_LABELS[option.source]}`}
                  title={`${option.label} (${SOURCE_LABELS[option.source]}): ${option.ref}`}
                  onClick={() => choose(option.ref)}
                  className="h-auto w-full py-2"
                >
                  <span className="flex w-full min-w-0 flex-col items-center gap-1">
                    <span className="flex size-7 items-center justify-center [&_svg]:size-5">
                      {iconElement(option.ref, ImageIcon, option.url)}
                    </span>
                    <span className="w-full truncate text-center text-xs">{option.label}</span>
                  </span>
                </ToggleChip>
              </li>
            ))}
          </ul>
          {hasNoResults ? (
            <p role="status" className="text-foreground/60 text-sm">
              No icons match “{settledQuery}”. Try a shorter name, or use an image address.
            </p>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={imageId} className="font-medium text-sm">
              Or use an image address
            </label>
            <div className="flex gap-2">
              <Input
                id={imageId}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                value={imageUrl}
                placeholder="https://example.com/logo.png"
                aria-invalid={imageError === undefined ? undefined : true}
                aria-describedby={imageError === undefined ? undefined : `${imageId}-error`}
                onChange={(event) => {
                  setImageUrl(event.target.value);
                  setImageError(undefined);
                }}
                onKeyDown={(event) => captureEnter(event, applyImageUrl)}
              />
              <Button variant="outline" onClick={applyImageUrl} content="Use" />
            </div>
            {imageError === undefined ? null : (
              <p id={`${imageId}-error`} className="text-destructive text-sm">
                {imageError}
              </p>
            )}
          </div>
        </fieldset>
      )}
    />
  );
}

/** The icon picker, bound to a form field holding an icon reference or null. */
export const IconField = bindToForm<FieldProps & IconPickerProps, string | null>(BoundIconField, 'IconField');

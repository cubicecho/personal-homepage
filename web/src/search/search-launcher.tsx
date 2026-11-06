import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Globe, House } from 'lucide-react';
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SearchEnginesDocument } from '@/__generated__/graphql';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Search } from '@/components/ui/icons';
import { ExternalLink, LayoutGrid } from '@/core/app-icons';
import { request } from '@/core/gql';
import { iconElement } from '@/core/page-icons';
import { hostOf } from '@/pages/form-checks';
import { ITEM_KINDS, OPENS_IN } from '@/pages/item-kinds';
import { type Item, type Page, usePages } from '@/pages/use-pages';
import { canStartShortcut, chordLabel, commandKeyLabel, isPaletteChord, SEARCH_CHORD } from './hotkeys';
import { type Engine, type MatchFields, parseQuery, rankMatches, scoreMatch, searchUrl } from './search-query';

/** The most items the launcher lists at once. */
const MAX_ITEM_RESULTS = 20;
/** The most pages the launcher lists at once. */
const MAX_PAGE_RESULTS = 8;
/** How long the engines are trusted before they are asked for again: a change to them shows within it. */
const ENGINES_STALE_MS = 60_000;

/** What the launcher offers to open. */
type Target =
  | { kind: 'item'; page: Page; item: Item }
  | { kind: 'page'; page: Page }
  | { kind: 'address'; url: string }
  | { kind: 'web'; engine: Engine; terms: string };

/** An item and the page it is on. */
interface PlacedItem {
  page: Page;
  item: Item;
}

/** What the rest of the app can ask of the launcher. */
interface SearchControls {
  /** Opens the launcher, empty. */
  openSearch: () => void;
}

const SearchContext = createContext<SearchControls | null>(null);

/**
 * The launcher's controls, for a button that opens it.
 *
 * @returns The controls.
 * @throws When used outside `SearchProvider`.
 */
function useSearchControls(): SearchControls {
  const controls = useContext(SearchContext);
  if (controls === null) {
    throw new Error('useSearchControls is used outside SearchProvider.');
  }
  return controls;
}

/**
 * The web searches the launcher offers.
 *
 * @returns The query.
 */
export function useSearchEngines() {
  return useQuery({
    queryKey: ['searchEngines'],
    queryFn: async () => (await request(SearchEnginesDocument)).searchEngines,
    staleTime: ENGINES_STALE_MS,
  });
}

/**
 * The text an item is found by.
 *
 * @param placed - The item and its page.
 * @returns Its title first, then its description, host and page title.
 */
function itemFields({ page, item }: PlacedItem): MatchFields {
  return { primary: item.title, secondary: [item.description ?? '', hostOf(item.url), page.title] };
}

/**
 * The text a page is found by.
 *
 * @param page - The page.
 * @returns Its title.
 */
function pageFields(page: Page): MatchFields {
  return { primary: page.title, secondary: [] };
}

/**
 * Where a page is in the app.
 *
 * @param page - The page.
 * @returns Its path: `/` for home.
 */
function pagePath(page: Page): string {
  return page.isHome ? '/' : `/pages/${encodeURIComponent(page.slug)}`;
}

/**
 * Opens an address in a new tab, without handing it this page.
 *
 * @param url - The address.
 */
function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Holds the launcher: the palette itself and the keys that open it, for the whole app.
 *
 * @remarks
 * Ctrl+K (⌘K on a Mac) opens and closes it, and so does the Search button. The chord does not open it
 * while a field has focus or a dialog or menu is open. Every shortcut holds a modifier: no bare key opens it.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');

  const openSearch = useCallback(() => {
    setText('');
    setIsOpen(true);
  }, []);

  useEffect(() => {
    /**
     * Opens or closes the launcher from the keyboard.
     *
     * @param event - A key press anywhere in the page.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isPaletteChord(event) === false) {
        return;
      }
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      } else if (canStartShortcut(event)) {
        event.preventDefault();
        openSearch();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, openSearch]);

  const controls = useMemo(() => ({ openSearch }), [openSearch]);

  return (
    <SearchContext.Provider value={controls}>
      {children}
      <SearchDialog open={isOpen} onOpenChange={setIsOpen} text={text} onTextChange={setText} />
    </SearchContext.Provider>
  );
}

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  onTextChange: (text: string) => void;
}

/** The palette: items, pages, an address and the web, filtered by what is typed. */
function SearchDialog({ open, onOpenChange, text, onTextChange }: SearchDialogProps) {
  const navigate = useNavigate();
  const pages = usePages().data ?? [];
  const engines = useSearchEngines().data ?? [];
  const defaultEngine = engines.find((engine) => engine.isDefault);
  /** Whether the Enter that is choosing a row held Ctrl or ⌘: open it in a new tab. */
  const wantsNewTab = useRef(false);
  const commandKey = commandKeyLabel();

  const query = parseQuery(text, engines);
  const placedItems = useMemo(
    () => pages.flatMap((page) => page.items.map((item): PlacedItem => ({ page, item }))),
    [pages],
  );
  const isText = query.kind === 'text';
  const items = isText ? rankMatches(placedItems, query.text, itemFields, MAX_ITEM_RESULTS) : [];
  const listedPages = isText ? rankMatches(pages, query.text, pageFields, MAX_PAGE_RESULTS) : pages;
  const showsPages = query.kind !== 'bang';

  /**
   * Opens what a row offers, then closes the launcher.
   *
   * @param target - The row's target.
   */
  const choose = (target: Target): void => {
    const newTab = wantsNewTab.current;
    wantsNewTab.current = false;
    onOpenChange(false);
    if (target.kind === 'page') {
      if (newTab) {
        openInNewTab(pagePath(target.page));
        return;
      }
      void navigate(target.page.isHome ? { to: '/' } : { to: '/pages/$slug', params: { slug: target.page.slug } });
      return;
    }
    if (target.kind === 'address' || target.kind === 'web') {
      const url = target.kind === 'address' ? target.url : searchUrl(target.engine, target.terms);
      if (newTab) {
        openInNewTab(url);
      } else {
        window.location.assign(url);
      }
      return;
    }
    const { page, item } = target;
    if (item.url === null) {
      // A widget with no address of its own: its page is where it is.
      void navigate(page.isHome ? { to: '/' } : { to: '/pages/$slug', params: { slug: page.slug } });
      return;
    }
    if (newTab || item.opensIn === 'NEW_TAB') {
      openInNewTab(item.url);
    } else if (item.opensIn === 'SAME_TAB') {
      window.location.assign(item.url);
    } else if (item.opensIn === 'APP') {
      void navigate({ to: '/pages/$slug/apps/$itemId', params: { slug: page.slug, itemId: item.id } });
    } else {
      void navigate(page.isHome ? { to: '/' } : { to: '/pages/$slug', params: { slug: page.slug } });
    }
  };

  /**
   * Notes whether the Enter about to choose a row held Ctrl or ⌘. The palette's own handler runs
   * after this one and picks the row.
   *
   * @param event - A key press in the search box.
   */
  const noteModifiers = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      wantsNewTab.current = event.ctrlKey || event.metaKey;
    }
  };

  // The group whose best match is better goes first, so Enter opens the best match: typing a
  // page's name opens the page, not an item that is only on it.
  const [topItem] = items;
  const [topPage] = listedPages;
  const pagesFirst =
    isText && topItem !== undefined && topPage !== undefined
      ? scoreMatch(pageFields(topPage), query.text) > scoreMatch(itemFields(topItem), query.text)
      : false;
  const itemGroup =
    items.length > 0 ? (
      <CommandGroup heading="Items">
        {items.map(({ page, item }) => (
          <ItemRow key={`${page.slug}/${item.id}`} page={page} item={item} onChoose={choose} />
        ))}
      </CommandGroup>
    ) : null;
  const pageGroup =
    showsPages && listedPages.length > 0 ? (
      <CommandGroup heading="Pages">
        {listedPages.map((page) => (
          <CommandItem key={page.slug} value={`page:${page.slug}`} onSelect={() => choose({ kind: 'page', page })}>
            <RowIcon>{iconElement(page.icon, page.isHome ? House : LayoutGrid, page.iconUrl)}</RowIcon>
            <span className="min-w-0 flex-1 truncate">{page.title}</span>
            <span className="text-foreground/60 text-xs">
              {page.items.length === 1 ? '1 item' : `${page.items.length} items`}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null;

  const bangHints = engines.map((engine) => `!${engine.prefix} ${engine.name}`).join(' · ');

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Find an item or a page, open an address, or search the web."
      label="Search items, pages and the web"
      shouldFilter={false}
    >
      <CommandInput
        value={text}
        onValueChange={onTextChange}
        placeholder={defaultEngine ? `Search items and pages, or ${defaultEngine.name}` : 'Search items and pages'}
        onKeyDown={noteModifiers}
        onFocus={(event) => event.currentTarget.setSelectionRange(text.length, text.length)}
      />
      <CommandList label="Results" className="max-h-[min(24rem,60svh)]">
        <CommandEmpty>
          Nothing matches. Check the spelling, or search the web with !{defaultEngine?.prefix}.
        </CommandEmpty>
        {pagesFirst ? pageGroup : itemGroup}
        {pagesFirst ? itemGroup : pageGroup}
        {query.kind === 'text' && query.url !== null ? (
          <CommandGroup heading="Address">
            <CommandItem value="address" onSelect={() => choose({ kind: 'address', url: query.url ?? '' })}>
              <ExternalLink />
              <span className="min-w-0 flex-1 truncate">Open {query.url}</span>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {query.kind === 'bang' && query.terms !== '' ? (
          <CommandGroup heading="Web">
            <CommandItem
              value={`web:${query.engine.prefix}`}
              onSelect={() => choose({ kind: 'web', engine: query.engine, terms: query.terms })}
            >
              <Globe />
              <span className="min-w-0 flex-1 truncate">
                Search {query.engine.name} for “{query.terms}”
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {query.kind === 'bang' && query.terms === '' ? (
          <p className="px-3 py-6 text-center text-foreground/60 text-sm">
            Type what to search {query.engine.name} for.
          </p>
        ) : null}
        {query.kind === 'text' && defaultEngine !== undefined ? (
          <CommandGroup heading="Web">
            <CommandItem
              value={`web:${defaultEngine.prefix}`}
              onSelect={() => choose({ kind: 'web', engine: defaultEngine, terms: query.text })}
            >
              <Globe />
              <span className="min-w-0 flex-1 truncate">
                Search {defaultEngine.name} for “{query.text}”
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-foreground/10 border-t px-3 py-2 text-foreground/60 text-xs">
        <span>
          <Key>↵</Key> open
        </span>
        <span>
          <Key>{commandKey} ↵</Key> open in a new tab
        </span>
        <span>
          <Key>Esc</Key> close
        </span>
        {bangHints === '' ? null : <span>{bangHints}</span>}
      </div>
    </CommandDialog>
  );
}

interface ItemRowProps {
  page: Page;
  item: Item;
  onChoose: (target: Target) => void;
}

/** One item in the results: its icon, title, page and host, and where it opens. */
function ItemRow({ page, item, onChoose }: ItemRowProps) {
  const opens = item.kind === 'FRAME' ? null : OPENS_IN[item.opensIn ?? 'NEW_TAB'];
  const Glyph = opens === null ? ITEM_KINDS.FRAME.Glyph : opens.Glyph;
  const opensLabel = opens === null ? `shown on ${page.title}` : opens.opensLabel;
  return (
    <CommandItem value={`item:${page.slug}/${item.id}`} onSelect={() => onChoose({ kind: 'item', page, item })}>
      <RowIcon>{iconElement(item.icon, Globe, item.iconUrl)}</RowIcon>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.title}</span>
        <span className="truncate text-foreground/60 text-xs">
          {page.title} · {hostOf(item.url)}
        </span>
      </span>
      <Glyph className="size-4" aria-hidden />
      <span className="sr-only">, {opensLabel}</span>
    </CommandItem>
  );
}

/** A row's icon, at one size whether it is a glyph or an image. */
function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center [&_svg]:size-5" aria-hidden>
      {children}
    </span>
  );
}

/** A key, as the hints draw it. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-foreground/20 px-1 font-sans text-[0.7rem] text-foreground/80">
      {children}
    </kbd>
  );
}

interface SearchButtonProps {
  /** `wide` for the sidebar, with its label and shortcut; `icon` for the phone bar. */
  variant: 'wide' | 'icon';
}

/** Opens the launcher, so the keyboard is not the only way in. */
export function SearchButton({ variant }: SearchButtonProps) {
  const { openSearch } = useSearchControls();
  const shortcut = chordLabel(SEARCH_CHORD);
  if (variant === 'icon') {
    return (
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Search"
        hint={`Search items, pages and the web (${shortcut})`}
        iconSlot={<Search />}
        onClick={() => openSearch()}
      />
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start text-foreground/60"
      iconSlot={<Search />}
      content="Search"
      trailingSlot={<Key>{shortcut}</Key>}
      aria-label={`Search (${shortcut})`}
      onClick={() => openSearch()}
    />
  );
}

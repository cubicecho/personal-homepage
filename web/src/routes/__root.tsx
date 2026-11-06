import { createLink, createRootRoute, Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { House } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { QueryState } from '@/components/query-state';
import { RouteError } from '@/components/route-error';
import {
  BarNavItem,
  Sidebar,
  SidebarCollapseButton,
  SidebarNavItem,
  SidebarSection,
  useSidebar,
} from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { ThemePicker } from '@/components/ui/theme-picker';
import { useThemePreference } from '@/components/ui/theme-preference';
import { LayoutGrid } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { ExportButton } from '@/export/export-button';
import { PageDialog } from '@/pages/page-dialog';
import { type Page, usePages } from '@/pages/use-pages';
import { commandKeyLabel } from '@/search/hotkeys';
import { SearchButton, SearchProvider } from '@/search/search-launcher';
import { ThemeMenu } from '@/shell/theme-menu';
import { useSidebarFold } from '@/shell/use-sidebar-fold';

const SidebarLink = createLink(SidebarNavItem);
const BarLink = createLink(BarNavItem);
/** How many pages the phone bar has room for beside the brand and its buttons; the rest are in its menu. */
const BAR_PAGE_COUNT = 4;

export const Route = createRootRoute({
  component: RootRoute,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
});

/**
 * The app's mark and name, as the sidebar's header and the phone bar both show it.
 *
 * @param props - How much room it has.
 * @param props.compact - Draw the mark alone, its name kept for screen readers: the phone bar has no room for it.
 * @returns The link home.
 */
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-md px-2 py-1 font-semibold text-foreground text-sm">
      <House className="size-4" aria-hidden />
      <span className={compact ? 'sr-only' : undefined}>Homepage</span>
    </Link>
  );
}

/**
 * The sidebar's header: the brand and the search button, each its icon alone while the sidebar is folded.
 *
 * @returns The header's rows.
 */
function SidebarHeader() {
  const { collapsed } = useSidebar();
  return (
    <div className={collapsed ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-2'}>
      <Brand compact={collapsed} />
      <SearchButton variant={collapsed ? 'icon' : 'wide'} />
    </div>
  );
}

/**
 * "New page" as a row of its own, for the folded sidebar: folded, the Pages section draws no title
 * row, so its + button is gone.
 *
 * @param props - What the row does.
 * @param props.label - What it is called.
 * @param props.onPress - Opens the new-page dialog.
 * @returns The row while folded, nothing while open.
 */
function FoldedNewPageRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { collapsed } = useSidebar();
  return collapsed ? <SidebarNavItem label={label} iconSlot={<Plus />} onClick={onPress} /> : null;
}

/**
 * The sidebar's footer: the zip download, the theme and the fold button, as icons while folded.
 *
 * @returns The footer's rows.
 */
function SidebarFooter() {
  const { collapsed } = useSidebar();
  const shortcut = `${commandKeyLabel()} B`;
  return (
    <div className={collapsed ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-2'}>
      <ExportButton compact={collapsed} />
      {collapsed ? <ThemeMenu /> : <ThemePicker variant="compact" />}
      <SidebarCollapseButton
        collapseLabel={`Collapse sidebar (${shortcut})`}
        expandLabel={`Expand sidebar (${shortcut})`}
      />
    </div>
  );
}

/**
 * The glyph a page's row wears.
 *
 * @param page - The page the row is for.
 * @returns Its icon, a house for home without one, or a grid.
 */
function pageIcon(page: Page) {
  return iconElement(page.icon, page.isHome ? House : LayoutGrid);
}

/**
 * The app shell: every page in the sidebar beside whichever page the route draws.
 *
 * @remarks
 * The theme preference is applied here, once for every page, and the new-page dialog lives here
 * because both the sidebar and the phone bar open it.
 */
function RootRoute() {
  useThemePreference();
  const navigate = useNavigate();
  const query = usePages();
  const pages = query.data ?? [];
  const { slug } = useParams({ strict: false });
  const currentSlug = slug ?? 'home';
  const [isCreating, setIsCreating] = useState(false);
  const [isFolded, setFolded] = useSidebarFold();
  const [createSession, setCreateSession] = useState(0);

  /** Opens a fresh new-page dialog. */
  const startCreating = (): void => {
    setCreateSession((count) => count + 1);
    setIsCreating(true);
  };

  /**
   * The router link props for a page: home is `/`, the rest are under `/pages`.
   *
   * @param page - The page.
   * @returns What `to` and `params` a link to it takes.
   */
  const linkTo = (page: Page) =>
    page.isHome ? ({ to: '/' } as const) : ({ to: '/pages/$slug', params: { slug: page.slug } } as const);

  const barPages = pages.slice(0, BAR_PAGE_COUNT);
  const hasMorePages = pages.length > BAR_PAGE_COUNT;
  const newPageLabel = 'New page';

  return (
    <SearchProvider>
      <SidebarLayout
        className="h-svh"
        sidebarPosition="start"
        sidebarWidth="auto"
        divider="none"
        sidebarHideBelow="md"
        brandSlot={<Brand compact />}
        navLabel="Pages"
        navSlot={barPages.map((page) => (
          <BarLink
            key={page.slug}
            {...linkTo(page)}
            label={page.title}
            iconSlot={pageIcon(page)}
            active={page.slug === currentSlug}
          />
        ))}
        actionSlot={
          <>
            <SearchButton variant="icon" />
            {hasMorePages ? (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="All pages" iconSlot={<LayoutGrid />} />
                </MenuTrigger>
                <MenuContent align="end">
                  {pages.map((page) => (
                    <MenuItem
                      key={page.slug}
                      iconSlot={pageIcon(page)}
                      label={page.title}
                      linkSlot={<Link {...linkTo(page)} />}
                    />
                  ))}
                </MenuContent>
              </Menu>
            ) : null}
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={newPageLabel}
              iconSlot={<Plus />}
              onClick={startCreating}
            />
            <div className="w-28">
              <ThemePicker variant="compact" />
            </div>
          </>
        }
        sidebarSlot={
          <Sidebar
            label="Main"
            collapsed={isFolded}
            onCollapsedChange={setFolded}
            headerSlot={<SidebarHeader />}
            contentSlot={
              <>
                <SidebarSection
                  as="nav"
                  title="Pages"
                  actionSlot={
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label={newPageLabel}
                      iconSlot={<Plus />}
                      onClick={startCreating}
                    />
                  }
                  status={
                    <QueryState
                      compact
                      query={query}
                      what="your pages"
                      count={pages.length}
                      emptySlot={<EmptyState compact title="No pages yet." className="px-2" />}
                    />
                  }
                  contentSlot={pages.map((page) => (
                    <SidebarLink
                      key={page.slug}
                      {...linkTo(page)}
                      label={page.title}
                      iconSlot={pageIcon(page)}
                      count={page.items.length}
                      active={page.slug === currentSlug}
                    />
                  ))}
                />
                <FoldedNewPageRow label={newPageLabel} onPress={startCreating} />
              </>
            }
            footerSlot={<SidebarFooter />}
          />
        }
        contentSlot={<Outlet />}
      />
      {isCreating ? (
        <PageDialog
          key={createSession}
          open
          onOpenChange={setIsCreating}
          onSaved={(page) => void navigate({ to: '/pages/$slug', params: { slug: page.slug } })}
        />
      ) : null}
    </SearchProvider>
  );
}

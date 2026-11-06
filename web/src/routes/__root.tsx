import { createLink, createRootRoute, Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { House } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { QueryState } from '@/components/query-state';
import { RouteError } from '@/components/route-error';
import { BarNavItem, Sidebar, SidebarNavItem, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { ThemePicker } from '@/components/ui/theme-picker';
import { useThemePreference } from '@/components/ui/theme-preference';
import { LayoutGrid } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { PageDialog } from '@/pages/page-dialog';
import { type Page, usePages } from '@/pages/use-pages';

const SidebarLink = createLink(SidebarNavItem);
const BarLink = createLink(BarNavItem);
/** How many pages the phone bar has room for beside the brand and its buttons; the rest are in its menu. */
const BAR_PAGE_COUNT = 4;

export const Route = createRootRoute({
  component: RootRoute,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
});

/** The app's mark and name, as the sidebar's header and the phone bar both show it. */
function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-md px-2 py-1 font-semibold text-foreground text-sm">
      <House className="size-4" aria-hidden />
      Homepage
    </Link>
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
    <>
      <SidebarLayout
        className="h-svh"
        sidebarPosition="start"
        sidebarWidth="auto"
        divider="none"
        sidebarHideBelow="md"
        brandSlot={<Brand />}
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
            headerSlot={<Brand />}
            contentSlot={
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
            }
            footerSlot={<ThemePicker variant="compact" />}
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
    </>
  );
}

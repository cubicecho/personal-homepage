import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useRef } from 'react';
import { useAccess } from '@/auth/use-access';
import { capTitle, iconFromParam, isWebAddress, parseAddLinkSearch } from '@/bookmarklet/add-link';
import { EmptyState } from '@/components/empty-state';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Ban } from '@/core/app-icons';
import { AddToPageDialog } from '@/pages/add-to-page-dialog';
import { type Page, usePageLimits, usePages } from '@/pages/use-pages';

export const Route = createFileRoute('/add')({
  component: AddLinkRoute,
  validateSearch: parseAddLinkSearch,
});

/** Where the page last added to is remembered, so the next add starts there. */
const LAST_PAGE_KEY = 'homepage.add.last-page';

/**
 * Reads the page last added to.
 *
 * @returns Its slug, or undefined when there is none or storage can't be read.
 */
function lastPage(): string | undefined {
  try {
    return localStorage.getItem(LAST_PAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Remembers the page last added to.
 *
 * @param slug - Its slug.
 */
function rememberLastPage(slug: string): void {
  try {
    localStorage.setItem(LAST_PAGE_KEY, slug);
  } catch {
    // Blocked storage: the next add starts on Home.
  }
}

/**
 * `/add?url=…&title=…`, where the bookmarklet lands: the Add item dialog, filled in from the page it was
 * clicked on, then from what that page's address says.
 *
 * @returns The page, with the dialog open, or why it can't add.
 */
function AddLinkRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const canEdit = useAccess().data?.canEdit === true;
  const pages = usePages();
  const limits = usePageLimits().data;
  const addedTo = useRef<Page | null>(null);

  const goHome = <Button variant="outline" linkSlot={<Link to="/" />} content="Go to the homepage" />;
  if (canEdit === false) {
    return (
      <PageLayout
        title="Add to homepage"
        contentSlot={
          <EmptyState
            level={2}
            iconSlot={<Ban />}
            title="You can't add to this homepage"
            description="Only the people who look after this homepage can add to it."
            actionSlot={goHome}
          />
        }
      />
    );
  }
  const { url } = search;
  if (isWebAddress(url) === false) {
    return (
      <PageLayout
        title="Add to homepage"
        contentSlot={
          <EmptyState
            level={2}
            iconSlot={<Ban />}
            title="This address can't be added"
            description="Only http:// and https:// addresses can be added to the homepage."
            actionSlot={goHome}
          />
        }
      />
    );
  }
  if (pages.data === undefined || limits === undefined) {
    return <PageLayout title="Add to homepage" loading contentSlot={null} />;
  }

  /**
   * Leaves for the page the item went to, or home when the dialog was closed without adding.
   *
   * @param isOpen - Whether the dialog is open.
   */
  const onOpenChange = (isOpen: boolean): void => {
    if (isOpen) {
      return;
    }
    const page = addedTo.current;
    if (page === null || page.isHome) {
      void navigate({ to: '/' });
      return;
    }
    void navigate({ to: '/pages/$slug', params: { slug: page.slug } });
  };

  const host = new URL(url).host;
  return (
    <PageLayout
      title="Add to homepage"
      description={url}
      contentSlot={
        <AddToPageDialog
          open
          onOpenChange={onOpenChange}
          title={`Add ${search.title ?? host} to a page`}
          prefill={{
            title: capTitle(search.title ?? '', limits.maxTitleLength),
            url,
            icon: iconFromParam(search.icon),
            description: search.description ?? null,
            discoveredId: null,
          }}
          defaultPageSlug={lastPage()}
          autoFillIn
          onAdded={(page, title) => {
            addedTo.current = page;
            rememberLastPage(page.slug);
            toast(`Added ${title} to ${page.title}.`, 'positive');
          }}
        />
      }
    />
  );
}

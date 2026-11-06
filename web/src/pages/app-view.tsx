import { Link } from '@tanstack/react-router';
import { EmptyState } from '@/components/empty-state';
import { PageLayout } from '@/components/page-layout';
import { QueryError } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icons';
import { AppWindow, ExternalLink } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { FrameCheckNotice } from '@/frames/frame-check-notice';
import { FRAME_SANDBOX } from './item-frame';
import { findPage, type Page, usePages } from './use-pages';

interface AppViewProps {
  /** The page the app is on. */
  slug: string;
  /** The app item's id. */
  itemId: string;
}

/**
 * A link back to a page.
 *
 * @param page - The page to go back to.
 * @returns The router link: `/` for home, `/pages/$slug` for the rest.
 */
function BackLink({ page }: { page: Page }) {
  const className = 'inline-flex items-center gap-1 text-info text-sm';
  const label = (
    <>
      <ArrowLeft className="size-4" aria-hidden />
      {page.title}
    </>
  );
  return page.isHome ? (
    <Link to="/" className={className}>
      {label}
    </Link>
  ) : (
    <Link to="/pages/$slug" params={{ slug: page.slug }} className={className}>
      {label}
    </Link>
  );
}

/** One app item, framed across the whole content area, with a way back and a way out to the browser. */
export function AppView({ slug, itemId }: AppViewProps) {
  const query = usePages();

  if (query.isError) {
    return (
      <PageLayout
        title="App"
        contentSlot={<QueryError error={query.error} onRetry={query.refetch} what="this app" />}
      />
    );
  }
  if (query.isPending) {
    return <PageLayout title="" loading contentSlot={null} />;
  }

  const page = findPage(query.data, slug);
  const item = page?.items.find((candidate) => candidate.id === itemId);
  if (page === undefined || item === undefined) {
    return (
      <PageLayout
        title="App not found"
        contentSlot={
          <EmptyState
            level={2}
            iconSlot={<AppWindow />}
            title="There is no app here"
            description="It may have been removed from its page, or the link has a typo."
            actionSlot={<Button variant="outline" linkSlot={<Link to="/" />} content="Go home" />}
          />
        }
      />
    );
  }

  return (
    <PageLayout
      width="full"
      scroll={false}
      title={item.title}
      iconSlot={iconElement(item.icon, AppWindow, item.iconUrl)}
      breadcrumbsSlot={<BackLink page={page} />}
      description="If the frame stays blank, the site refuses to be shown inside another page. Open it in the browser instead."
      actionSlot={
        <Button
          size="sm"
          variant="outline"
          linkSlot={<a href={item.url} target="_blank" rel="noreferrer" />}
          iconSlot={<ExternalLink />}
          content="Open in the browser"
        />
      }
      contentSlot={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <FrameCheckNotice
            url={item.url}
            actionSlot={
              <Button
                size="sm"
                variant="info"
                linkSlot={<a href={item.url} target="_blank" rel="noreferrer" />}
                iconSlot={<ExternalLink />}
                content="Open in the browser"
              />
            }
          />
          <iframe
            src={item.url}
            title={item.title}
            sandbox={FRAME_SANDBOX}
            referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 rounded-md border border-foreground/10 bg-background"
          />
        </div>
      }
    />
  );
}

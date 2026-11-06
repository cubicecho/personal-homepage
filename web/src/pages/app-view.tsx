import { Link } from '@tanstack/react-router';
import { EmptyState } from '@/components/empty-state';
import { HeaderContentFooter } from '@/components/header-content-footer';
import { PageLayout } from '@/components/page-layout';
import { QueryError } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from '@/components/ui/icons';
import { AppWindow, ExternalLink } from '@/core/app-icons';
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
 * The way back to an app's page, as a small button.
 *
 * @param page - The page to go back to.
 * @returns The button, linking to `/` for home and `/pages/$slug` for the rest.
 */
function BackButton({ page }: { page: Page }) {
  const link = page.isHome ? <Link to="/" /> : <Link to="/pages/$slug" params={{ slug: page.slug }} />;
  return (
    <Button
      size="xs"
      variant="ghost"
      linkSlot={link}
      iconSlot={<ArrowLeft />}
      content="Back"
      aria-label={`Back to ${page.title}`}
    />
  );
}

/** One app item, framed across the whole content area under a slim bar: back to its page, and out to the browser. */
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

  const openInBrowser = (
    <Button
      size="xs"
      variant="outline"
      linkSlot={<a href={item.url} target="_blank" rel="noreferrer" />}
      iconSlot={<ExternalLink />}
      content="Open in the browser"
    />
  );
  return (
    <HeaderContentFooter
      width="full"
      scroll
      className="h-full"
      headerClassName="border-foreground/10 border-b"
      headerSlot={
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          {/* The app's name is left off the bar to give the frame the room; the page still has a heading. */}
          <h1 className="sr-only">{item.title}</h1>
          <BackButton page={page} />
          {openInBrowser}
        </div>
      }
      contentClassName="flex flex-col"
      contentSlot={
        <>
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
            className="min-h-0 w-full flex-1 border-0 bg-background"
          />
        </>
      }
    />
  );
}

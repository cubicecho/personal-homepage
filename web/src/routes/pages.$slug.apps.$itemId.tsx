import { createFileRoute } from '@tanstack/react-router';
import { AppView } from '@/pages/app-view';

export const Route = createFileRoute('/pages/$slug/apps/$itemId')({ component: AppRoute });

/** An app item, framed across the content area. */
function AppRoute() {
  const { slug, itemId } = Route.useParams();
  return <AppView slug={slug} itemId={itemId} />;
}

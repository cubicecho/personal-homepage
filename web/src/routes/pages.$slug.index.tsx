import { createFileRoute } from '@tanstack/react-router';
import { PageView } from '@/pages/page-view';

export const Route = createFileRoute('/pages/$slug/')({ component: PageRoute });

/** Any page, by its slug. */
function PageRoute() {
  const { slug } = Route.useParams();
  return <PageView slug={slug} />;
}

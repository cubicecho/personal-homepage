import { createFileRoute } from '@tanstack/react-router';
import { PageView } from '@/pages/page-view';

export const Route = createFileRoute('/')({ component: HomeRoute });

/** The home page, which is always there. */
function HomeRoute() {
  return <PageView slug="home" />;
}

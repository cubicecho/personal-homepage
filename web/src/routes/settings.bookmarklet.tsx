import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useAccess } from '@/auth/use-access';
import { BookmarkletView } from '@/bookmarklet/bookmarklet-view';

export const Route = createFileRoute('/settings/bookmarklet')({ component: BookmarkletSettingsRoute });

/**
 * Settings' Bookmarklet section. Editors only: it adds to the homepage, so anyone else is sent back to
 * the first section.
 *
 * @returns The section, or a redirect.
 */
function BookmarkletSettingsRoute() {
  const access = useAccess().data;
  if (access === undefined) {
    return null;
  }
  return access.canEdit ? <BookmarkletView /> : <Navigate to="/settings" replace />;
}

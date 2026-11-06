import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Ellipsis, Pencil, Plus, Trash2 } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { ArrowDown, ArrowUp } from '@/core/app-icons';
import { messageOf } from '@/lib/error-message';
import { SectionDialog } from '@/sections/section-dialog';
import { PageDialog } from './page-dialog';
import { type Page, useDeletePage, useMovePage } from './use-pages';

interface PageMenuProps {
  page: Page;
  /** Every page, home first, for where this one can move to. */
  pages: readonly Page[];
}

/** Counts the items on a page, for the delete question. */
function itemCount(page: Page): string {
  const count = page.items.length;
  return count === 1 ? '1 item' : `${count} items`;
}

/** The ⋯ menu on a page: edit, add a section, move up or down, delete. Home can't be moved or deleted. */
export function PageMenu({ page, pages }: PageMenuProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const movePage = useMovePage();
  const deletePage = useDeletePage();
  const [isEditing, setIsEditing] = useState(false);
  const [editSession, setEditSession] = useState(0);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [sectionSession, setSectionSession] = useState<number | null>(null);
  const index = pages.findIndex((known) => known.slug === page.slug);
  // Home is always first, so the first place another page can take is 1.
  const isFirstMovable = index <= 1;
  const isLast = index === pages.length - 1;
  const shouldShowPlaceActions = page.isHome === false;

  /**
   * Moves the page one place, and says so when the server refuses.
   *
   * @param toIndex - Where it goes in the whole list.
   */
  const move = (toIndex: number): void => {
    movePage.mutate(
      { slug: page.slug, toIndex },
      { onError: (error) => toast(`Couldn't move ${page.title}. ${messageOf(error) ?? ''}`.trim()) },
    );
  };

  /** Deletes the page and goes home, or says why it could not. */
  const remove = (): void => {
    deletePage.mutate(page.slug, {
      onSuccess: () => {
        toast(`Deleted ${page.title}.`, 'positive');
        void navigate({ to: '/' });
      },
      onError: (error) => toast(`Couldn't delete ${page.title}. ${messageOf(error) ?? ''}`.trim()),
    });
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={`Actions for ${page.title}`} iconSlot={<Ellipsis />} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            iconSlot={<Pencil />}
            label="Edit page"
            onSelect={() => {
              setEditSession((count) => count + 1);
              setIsEditing(true);
            }}
          />
          <MenuItem
            iconSlot={<Plus />}
            label="Add section"
            onSelect={() => setSectionSession((count) => (count ?? 0) + 1)}
          />
          {shouldShowPlaceActions ? (
            <>
              <MenuItem
                iconSlot={<ArrowUp />}
                label="Move up"
                disabled={isFirstMovable}
                onSelect={() => move(index - 1)}
              />
              <MenuItem iconSlot={<ArrowDown />} label="Move down" disabled={isLast} onSelect={() => move(index + 1)} />
              <MenuSeparator />
              <MenuItem
                iconSlot={<Trash2 />}
                label="Delete page"
                destructive
                onSelect={() => setIsConfirmingDelete(true)}
              />
            </>
          ) : null}
        </MenuContent>
      </Menu>
      {isEditing ? <PageDialog key={editSession} open onOpenChange={setIsEditing} page={page} /> : null}
      {sectionSession === null ? null : (
        <SectionDialog
          key={sectionSession}
          open
          onOpenChange={(isOpen) => {
            if (isOpen === false) {
              setSectionSession(null);
            }
          }}
          page={page}
        />
      )}
      <ConfirmDialog
        open={isConfirmingDelete}
        onOpenChange={setIsConfirmingDelete}
        title={`Delete ${page.title}?`}
        description={`The page and its ${itemCount(page)} go, and it leaves the sidebar. The services they point at are not touched.`}
        confirmLabel="Delete page"
        onConfirm={remove}
      />
    </>
  );
}

import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { OpenInstanceNotice } from '@/auth/open-instance-notice';
import { EmptyState } from '@/components/empty-state';
import { LoadError } from '@/components/load-state';
import { PageLayout } from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Pencil, Plus } from '@/components/ui/icons';
import { LayoutGrid } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { SectionView } from '@/sections/section-view';
import { EditModeToggle, useEditMode } from '@/shell/edit-mode';
import { ItemDialog } from './item-dialog';
import { PageMenu } from './page-menu';
import { findPage, type Item, type Page, usePages } from './use-pages';

/** Which item dialog the page has open: none, a new item (into a section), or one item's edit. */
type ItemEditing = { item: Item | undefined; sectionId: string | undefined; session: number } | null;

interface PageViewProps {
  /** The page to show. */
  slug: string;
}

/** One page: its title, its menu, and its sections of tiles and frames. */
export function PageView({ slug }: PageViewProps) {
  const query = usePages();
  const { isEditing } = useEditMode();
  const [editing, setEditing] = useState<ItemEditing>(null);
  const [sessions, setSessions] = useState(0);

  /**
   * Opens the dialog that adds an item, fresh each time.
   *
   * @param [sectionId] - The section to add it to; left out for the page's first.
   */
  const openAddDialog = (sectionId?: string): void => {
    setSessions((count) => count + 1);
    setEditing({ item: undefined, sectionId, session: sessions + 1 });
  };

  /**
   * Opens the dialog that edits an item, fresh each time.
   *
   * @param item - The item.
   */
  const openEditDialog = (item: Item): void => {
    setSessions((count) => count + 1);
    setEditing({ item, sectionId: undefined, session: sessions + 1 });
  };

  if (query.isError) {
    return (
      <PageLayout
        title="Homepage"
        contentSlot={<LoadError error={query.error} onRetry={query.refetch} what="your pages" />}
      />
    );
  }
  if (query.isPending) {
    return <PageLayout title="" loading contentSlot={null} />;
  }

  const pages = query.data;
  const page = findPage(pages, slug);
  if (page === undefined) {
    return (
      <PageLayout
        title="Page not found"
        contentSlot={
          <EmptyState
            level={2}
            iconSlot={<LayoutGrid />}
            title="There is no page here"
            description="It may have been deleted, or the link has a typo."
            actionSlot={<Button variant="outline" linkSlot={<Link to="/" />} content="Go home" />}
          />
        }
      />
    );
  }

  return (
    <>
      <PageLayout
        title={page.title}
        iconSlot={iconElement(page.icon, LayoutGrid, page.iconUrl)}
        actionSlot={
          <>
            {isEditing ? (
              <>
                <Button
                  size="sm"
                  variant="info"
                  iconSlot={<Plus />}
                  content="Add item"
                  onClick={() => openAddDialog()}
                />
                <PageMenu page={page} pages={pages} />
              </>
            ) : null}
            <EditModeToggle variant="wide" />
          </>
        }
        contentSlot={
          <>
            <OpenInstanceNotice />
            <PageSections page={page} onAdd={openAddDialog} onEdit={openEditDialog} />
          </>
        }
      />
      {editing === null ? null : (
        <ItemDialog
          key={editing.session}
          open
          onOpenChange={(isOpen) => {
            if (isOpen === false) {
              setEditing(null);
            }
          }}
          page={page}
          item={editing.item}
          sectionId={editing.sectionId}
        />
      )}
    </>
  );
}

interface PageSectionsProps {
  page: Page;
  /** Opens the dialog that adds an item, to a section or the page's first. */
  onAdd: (sectionId?: string) => void;
  /** Opens the dialog that edits an item. */
  onEdit: (item: Item) => void;
}

/**
 * What an empty page offers: Add item in edit mode, switching edit mode on for an editor in view mode,
 * and nothing to someone who can't edit.
 *
 * @param props - How to add.
 * @param props.onAdd - Opens the dialog that adds an item.
 * @returns The empty state.
 */
function EmptyPage({ onAdd }: { onAdd: () => void }) {
  const { isEditing, canEdit, setEditing } = useEditMode();
  if (isEditing) {
    return (
      <EmptyState
        iconSlot={<LayoutGrid />}
        title="Nothing on this page yet"
        description="Add a link to a service on your network, to open in a tab or inside this page, or a frame to show one here."
        actionSlot={<Button variant="info" iconSlot={<Plus />} content="Add item" onClick={onAdd} />}
      />
    );
  }
  return (
    <EmptyState
      iconSlot={<LayoutGrid />}
      title="Nothing on this page yet"
      description={canEdit ? 'Switch to edit mode to add links, frames and widgets.' : undefined}
      actionSlot={
        canEdit ? (
          <Button variant="outline" iconSlot={<Pencil />} content="Edit this page" onClick={() => setEditing(true)} />
        ) : null
      }
    />
  );
}

/** A page's sections in order, or what to do when the page has nothing on it. */
function PageSections({ page, onAdd, onEdit }: PageSectionsProps) {
  const isBlank = page.items.length === 0 && page.sections.length === 1;
  if (isBlank) {
    return <EmptyPage onAdd={() => onAdd()} />;
  }

  return page.sections.map((section, index) => (
    <SectionView
      key={section.id}
      page={page}
      section={section}
      index={index}
      onAddItem={() => onAdd(section.id)}
      onEditItem={onEdit}
    />
  ));
}

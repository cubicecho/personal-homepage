import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageLayout } from '@/components/page-layout';
import { QueryError } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { LayoutGrid } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { ItemDialog } from './item-dialog';
import { ItemFrame } from './item-frame';
import { ItemMenu } from './item-menu';
import { ItemTile } from './item-tile';
import { PageMenu } from './page-menu';
import { findPage, type Item, type Page, usePages } from './use-pages';

/** A run of consecutive items drawn the same way: tiles share a grid, a frame stands alone. */
type Segment = { kind: 'tiles'; entries: IndexedItem[] } | { kind: 'frame'; entry: IndexedItem };

/** An item and where it sits on its page. */
interface IndexedItem {
  item: Item;
  index: number;
}

/**
 * Groups a page's items for drawing: consecutive tiles into one grid, each frame on its own.
 *
 * @param items - The page's items, in order.
 * @returns The segments, in order.
 */
function segmentsOf(items: readonly Item[]): Segment[] {
  const segments: Segment[] = [];
  items.forEach((item, index) => {
    const entry = { item, index };
    if (item.kind === 'FRAME') {
      segments.push({ kind: 'frame', entry });
      return;
    }
    const last = segments.at(-1);
    if (last?.kind === 'tiles') {
      last.entries.push(entry);
    } else {
      segments.push({ kind: 'tiles', entries: [entry] });
    }
  });
  return segments;
}

/** Which dialog the page has open: none, a new item, or one item's edit. */
type ItemEditing = { item: Item | undefined; session: number } | null;

interface PageViewProps {
  /** The page to show. */
  slug: string;
}

/** One page: its title, its menu, and its items as tiles and frames. */
export function PageView({ slug }: PageViewProps) {
  const query = usePages();
  const [editing, setEditing] = useState<ItemEditing>(null);
  const [sessions, setSessions] = useState(0);

  /**
   * Opens the item dialog, fresh each time.
   *
   * @param [item] - The item to edit; left out to add one.
   */
  const openItemDialog = (item?: Item): void => {
    setSessions((count) => count + 1);
    setEditing({ item, session: sessions + 1 });
  };

  if (query.isError) {
    return (
      <PageLayout
        title="Homepage"
        contentSlot={<QueryError error={query.error} onRetry={query.refetch} what="your pages" />}
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
        iconSlot={iconElement(page.icon, LayoutGrid)}
        actionSlot={
          <>
            <Button size="sm" variant="info" iconSlot={<Plus />} content="Add item" onClick={() => openItemDialog()} />
            <PageMenu page={page} pages={pages} />
          </>
        }
        contentSlot={<PageItems page={page} onAdd={() => openItemDialog()} onEdit={openItemDialog} />}
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
        />
      )}
    </>
  );
}

interface PageItemsProps {
  page: Page;
  /** Opens the dialog that adds an item. */
  onAdd: () => void;
  /** Opens the dialog that edits an item. */
  onEdit: (item: Item) => void;
}

/** A page's items, or what to do when it has none. */
function PageItems({ page, onAdd, onEdit }: PageItemsProps) {
  if (page.items.length === 0) {
    return (
      <EmptyState
        iconSlot={<LayoutGrid />}
        title="Nothing on this page yet"
        description="Add a link to a service on your network, an app to open inside this page, or a frame to show one here."
        actionSlot={<Button variant="info" iconSlot={<Plus />} content="Add item" onClick={onAdd} />}
      />
    );
  }

  /**
   * Draws an item's ⋯ menu.
   *
   * @param entry - The item and its place.
   * @returns The menu.
   */
  const menuFor = ({ item, index }: IndexedItem) => (
    <ItemMenu page={page} item={item} index={index} onEdit={() => onEdit(item)} />
  );

  return segmentsOf(page.items).map((segment) =>
    segment.kind === 'frame' ? (
      <ItemFrame key={segment.entry.item.id} item={segment.entry.item} menuSlot={menuFor(segment.entry)} />
    ) : (
      <ul
        key={segment.entries[0]?.item.id}
        aria-label={`${page.title} tiles`}
        className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3"
      >
        {segment.entries.map((entry) => (
          <ItemTile key={entry.item.id} page={page} item={entry.item} menuSlot={menuFor(entry)} />
        ))}
      </ul>
    ),
  );
}

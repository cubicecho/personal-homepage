import { Disclosure } from '@/components/disclosure';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { ItemFrame } from '@/pages/item-frame';
import { ItemMenu } from '@/pages/item-menu';
import { ItemTile } from '@/pages/item-tile';
import type { Item, Page, Section } from '@/pages/use-pages';
import { useSectionOpen } from './fold-state';
import { SectionMenu } from './section-menu';

/** A run of consecutive items drawn the same way: tiles share a grid, a frame stands alone. */
type Segment = { kind: 'tiles'; entries: IndexedItem[] } | { kind: 'frame'; entry: IndexedItem };

/** An item and where it sits in its section. */
interface IndexedItem {
  item: Item;
  index: number;
}

/**
 * Groups a section's items for drawing: consecutive tiles into one grid, each frame on its own.
 *
 * @param items - The section's items, in order.
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

interface SectionViewProps {
  page: Page;
  section: Section;
  /** Where the section is on its page, from 0. */
  index: number;
  /** Opens the dialog that adds an item to this section. */
  onAddItem: () => void;
  /** Opens the dialog that edits an item. */
  onEditItem: (item: Item) => void;
}

/**
 * One section of a page. A titled section is a heading that folds; an untitled one draws its items
 * bare, with only its menu above them when the page has other sections to tell it from.
 */
export function SectionView({ page, section, index, onAddItem, onEditItem }: SectionViewProps) {
  const [isOpen, setOpen] = useSectionOpen(page.slug, section);
  const menu = <SectionMenu page={page} section={section} index={index} onAddItem={onAddItem} />;
  const items = <SectionItems page={page} section={section} onAddItem={onAddItem} onEditItem={onEditItem} />;

  if (section.title === null) {
    const hasSiblings = page.sections.length > 1;
    return (
      <div className="flex flex-col gap-3">
        {hasSiblings ? <div className="flex justify-end">{menu}</div> : null}
        {items}
      </div>
    );
  }

  const count = section.items.length;
  return (
    <Disclosure
      title={section.title}
      description={count === 1 ? '1 item' : `${count} items`}
      open={isOpen}
      onOpenChange={setOpen}
      actionSlot={menu}
      titleClassName="font-semibold text-base text-foreground"
      contentClassName="pt-3"
      contentSlot={items}
    />
  );
}

interface SectionItemsProps {
  page: Page;
  section: Section;
  onAddItem: () => void;
  onEditItem: (item: Item) => void;
}

/** A section's items as tile grids and frames, or one line saying it is empty. */
function SectionItems({ page, section, onAddItem, onEditItem }: SectionItemsProps) {
  if (section.items.length === 0) {
    return (
      <EmptyState
        compact
        title="Nothing in this section yet."
        actionSlot={<Button size="sm" variant="outline" iconSlot={<Plus />} content="Add item" onClick={onAddItem} />}
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
    <ItemMenu page={page} section={section} item={item} index={index} onEdit={() => onEditItem(item)} />
  );
  const label = section.title === null ? `${page.title} tiles` : `${section.title} tiles`;

  return (
    <div className="flex flex-col gap-3">
      {segmentsOf(section.items).map((segment) =>
        segment.kind === 'frame' ? (
          <ItemFrame key={segment.entry.item.id} item={segment.entry.item} menuSlot={menuFor(segment.entry)} />
        ) : (
          <ul
            key={segment.entries[0]?.item.id}
            aria-label={label}
            className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3"
          >
            {segment.entries.map((entry) => (
              <ItemTile key={entry.item.id} page={page} item={entry.item} menuSlot={menuFor(entry)} />
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

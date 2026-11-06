import { useCanEdit } from '@/auth/use-access';
import { Disclosure } from '@/components/disclosure';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { ItemFrame } from '@/pages/item-frame';
import { ItemMenu } from '@/pages/item-menu';
import { ItemTile } from '@/pages/item-tile';
import { type AddressedItem, hasAddress, type Item, type Page, type Section } from '@/pages/use-pages';
import { WidgetCard } from '@/widgets/widget-card';
import { useSectionOpen } from './fold-state';
import { SectionMenu } from './section-menu';

/** A run of consecutive items drawn the same way: tiles share a grid, a frame or a widget stands alone. */
type Segment =
  | { kind: 'tiles'; entries: IndexedItem<AddressedItem>[] }
  | { kind: 'frame'; entry: IndexedItem<AddressedItem> }
  | { kind: 'widget'; entry: IndexedItem };

/** An item and where it sits in its section. */
interface IndexedItem<T extends Item = Item> {
  item: T;
  index: number;
}

/**
 * Groups a section's items for drawing: consecutive tiles into one grid, each frame and widget on its own.
 *
 * @param items - The section's items, in order.
 * @returns The segments, in order.
 */
function segmentsOf(items: readonly Item[]): Segment[] {
  const segments: Segment[] = [];
  items.forEach((item, index) => {
    if (item.kind === 'WIDGET') {
      segments.push({ kind: 'widget', entry: { item, index } });
      return;
    }
    // Links and frames always have an address; the check only tells the type so.
    if (hasAddress(item) === false) {
      return;
    }
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
  const canEdit = useCanEdit();
  const menu = canEdit ? <SectionMenu page={page} section={section} index={index} onAddItem={onAddItem} /> : null;
  const items = (
    <SectionItems page={page} section={section} canEdit={canEdit} onAddItem={onAddItem} onEditItem={onEditItem} />
  );

  if (section.title === null) {
    const hasSiblings = page.sections.length > 1;
    return (
      <div className="flex flex-col gap-3">
        {hasSiblings && menu !== null ? <div className="flex justify-end">{menu}</div> : null}
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
  /** Whether the caller may change the section: without it, no menus and no add button. */
  canEdit: boolean;
  onAddItem: () => void;
  onEditItem: (item: Item) => void;
}

/** A section's items as tile grids, frames and widgets, or one line saying it is empty. */
function SectionItems({ page, section, canEdit, onAddItem, onEditItem }: SectionItemsProps) {
  if (section.items.length === 0) {
    return (
      <EmptyState
        compact
        title="Nothing in this section yet."
        actionSlot={
          canEdit ? (
            <Button size="sm" variant="outline" iconSlot={<Plus />} content="Add item" onClick={onAddItem} />
          ) : null
        }
      />
    );
  }

  /**
   * Draws an item's ⋯ menu.
   *
   * @param entry - The item and its place.
   * @returns The menu.
   */
  const menuFor = ({ item, index }: IndexedItem) =>
    canEdit ? (
      <ItemMenu page={page} section={section} item={item} index={index} onEdit={() => onEditItem(item)} />
    ) : null;
  const label = section.title === null ? `${page.title} tiles` : `${section.title} tiles`;

  return (
    <div className="flex flex-col gap-3">
      {segmentsOf(section.items).map((segment) => {
        if (segment.kind === 'widget') {
          return (
            <WidgetCard
              key={segment.entry.item.id}
              page={page}
              item={segment.entry.item}
              menuSlot={menuFor(segment.entry)}
            />
          );
        }
        return segment.kind === 'frame' ? (
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
        );
      })}
    </div>
  );
}

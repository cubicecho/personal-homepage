import type { ReactNode } from 'react';
import { useCanEdit } from '@/auth/use-access';
import { Disclosure } from '@/components/disclosure';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { SECTION_GRID, SPAN_CLASSES } from '@/pages/column-span';
import { ItemFrame } from '@/pages/item-frame';
import { ItemMenu } from '@/pages/item-menu';
import { ItemTile } from '@/pages/item-tile';
import { hasAddress, type Item, type Page, type Section } from '@/pages/use-pages';
import { WidgetCard } from '@/widgets/widget-card';
import { useSectionOpen } from './fold-state';
import { SectionMenu } from './section-menu';

/** An item and where it sits in its section. */
interface IndexedItem<T extends Item = Item> {
  item: T;
  index: number;
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

/** A section's items in one grid: tiles one column wide, frames and widgets their chosen width; or one line saying it is empty. */
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
  const label = section.title === null ? `${page.title} items` : `${section.title} items`;

  /**
   * Draws one item the way its kind is drawn: a link as a tile, a frame inline, a widget as its data.
   *
   * @param entry - The item and its place.
   * @returns The item's card, or null for a link or frame that somehow has no address.
   */
  const cardFor = (entry: IndexedItem): ReactNode => {
    const { item } = entry;
    if (item.kind === 'WIDGET') {
      return <WidgetCard page={page} item={item} menuSlot={menuFor(entry)} />;
    }
    // Links and frames always have an address; the check only tells the type so.
    if (hasAddress(item) === false) {
      return null;
    }
    return item.kind === 'FRAME' ? (
      <ItemFrame item={item} menuSlot={menuFor(entry)} />
    ) : (
      <ItemTile page={page} item={item} menuSlot={menuFor(entry)} />
    );
  };

  return (
    <div className="@container w-full">
      <ul aria-label={label} className={SECTION_GRID}>
        {section.items.map((item, index) => (
          <li key={item.id} className={cn('min-w-0', SPAN_CLASSES[item.columnSpan])}>
            {cardFor({ item, index })}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { type ReactNode, useRef } from 'react';
import { Disclosure } from '@/components/disclosure';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Plus } from '@/components/ui/icons';
import { spanStyle } from '@/pages/column-span';
import { ItemFrame } from '@/pages/item-frame';
import { ItemMenu } from '@/pages/item-menu';
import { ItemTile } from '@/pages/item-tile';
import { hasAddress, type Item, type Page, type Section } from '@/pages/use-pages';
import { useIsEditing } from '@/shell/edit-mode';
import { WidgetCard } from '@/widgets/widget-card';
import { useSectionOpen } from './fold-state';
import { SectionMenu } from './section-menu';
import { useSectionColumns } from './use-section-columns';
import { useLayoutColumns } from './use-site-layout';

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
  // Folding a titled section is reading, not editing, so it works in view mode too; its menu does not.
  const isEditing = useIsEditing();
  const menu = isEditing ? <SectionMenu page={page} section={section} index={index} onAddItem={onAddItem} /> : null;
  const items = (
    <SectionItems page={page} section={section} isEditing={isEditing} onAddItem={onAddItem} onEditItem={onEditItem} />
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
      // The disclosure indents its body under the chevron; cards line up with the page's other sections instead.
      contentClassName="pt-3 pl-0"
      contentSlot={items}
    />
  );
}

interface SectionItemsProps {
  page: Page;
  section: Section;
  /** Whether the page is in edit mode: outside it, no menus and no add button. */
  isEditing: boolean;
  onAddItem: () => void;
  onEditItem: (item: Item) => void;
}

/** A section's items in one grid: tiles one column wide, frames and widgets their chosen width; or one line saying it is empty. */
function SectionItems({ page, section, isEditing, onAddItem, onEditItem }: SectionItemsProps) {
  const gridRef = useRef<HTMLUListElement>(null);
  const columns = useSectionColumns(gridRef, useLayoutColumns());

  if (section.items.length === 0) {
    return (
      <EmptyState
        compact
        title="Nothing in this section yet."
        actionSlot={
          isEditing ? (
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
    isEditing ? (
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
    <ul
      ref={gridRef}
      aria-label={label}
      // items-start: a tile keeps its own height beside a tall widget instead of stretching to the row's.
      className="grid w-full items-start gap-4"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {section.items.map((item, index) => (
        <li key={item.id} className="min-w-0" style={spanStyle(item, columns)}>
          {cardFor({ item, index })}
        </li>
      ))}
    </ul>
  );
}

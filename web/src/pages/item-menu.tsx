import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Ellipsis, Pencil, Trash2 } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { ArrowDown, ArrowUp } from '@/core/app-icons';
import { messageOf } from '@/lib/error-message';
import { type Item, type Page, useMoveItem, useRemoveItem } from './use-pages';

interface ItemMenuProps {
  page: Page;
  item: Item;
  /** Where the item is on its page, from 0. */
  index: number;
  /** Opens the item's edit dialog. */
  onEdit: () => void;
}

/** The ⋯ menu on an item: edit, move up or down, remove. */
export function ItemMenu({ page, item, index, onEdit }: ItemMenuProps) {
  const toast = useToast();
  const moveItem = useMoveItem();
  const removeItem = useRemoveItem();
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const isFirst = index === 0;
  const isLast = index === page.items.length - 1;

  /**
   * Moves the item one place, and says so when the server refuses.
   *
   * @param toIndex - Where it goes.
   */
  const move = (toIndex: number): void => {
    moveItem.mutate(
      { pageSlug: page.slug, id: item.id, toIndex },
      { onError: (error) => toast(`Couldn't move ${item.title}. ${messageOf(error) ?? ''}`.trim()) },
    );
  };

  /** Removes the item, and says so when the server refuses. */
  const remove = (): void => {
    removeItem.mutate(
      { pageSlug: page.slug, id: item.id },
      { onError: (error) => toast(`Couldn't remove ${item.title}. ${messageOf(error) ?? ''}`.trim()) },
    );
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={`Actions for ${item.title}`} iconSlot={<Ellipsis />} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem iconSlot={<Pencil />} label="Edit" onSelect={onEdit} />
          <MenuItem iconSlot={<ArrowUp />} label="Move up" disabled={isFirst} onSelect={() => move(index - 1)} />
          <MenuItem iconSlot={<ArrowDown />} label="Move down" disabled={isLast} onSelect={() => move(index + 1)} />
          <MenuSeparator />
          <MenuItem iconSlot={<Trash2 />} label="Remove" destructive onSelect={() => setIsConfirmingRemove(true)} />
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={isConfirmingRemove}
        onOpenChange={setIsConfirmingRemove}
        title={`Remove ${item.title}?`}
        description={`It comes off ${page.title}. The service it points at is not touched.`}
        confirmLabel="Remove item"
        onConfirm={remove}
      />
    </>
  );
}

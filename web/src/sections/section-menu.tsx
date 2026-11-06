import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Ellipsis, Pencil, Plus, Trash2 } from '@/components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { ArrowDown, ArrowUp } from '@/core/app-icons';
import { messageOf } from '@/lib/error-message';
import { type Page, type Section, sectionLabel, useMoveSection, useRemoveSection } from '@/pages/use-pages';
import { SectionDialog } from './section-dialog';

interface SectionMenuProps {
  page: Page;
  section: Section;
  /** Where the section is on its page, from 0. */
  index: number;
  /** Opens the add-item dialog with this section chosen. */
  onAddItem: () => void;
}

/**
 * Says how many items a section holds, for the remove question.
 *
 * @param section - The section.
 * @returns "1 item" or "N items".
 */
function itemCount(section: Section): string {
  const count = section.items.length;
  return count === 1 ? '1 item' : `${count} items`;
}

/** The ⋯ menu on a section: edit, move up or down, add an item to it, remove it. */
export function SectionMenu({ page, section, index, onAddItem }: SectionMenuProps) {
  const toast = useToast();
  const moveSection = useMoveSection();
  const removeSection = useRemoveSection();
  const [editSession, setEditSession] = useState<number | null>(null);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const label = sectionLabel(section);
  const isFirst = index === 0;
  const isLast = index === page.sections.length - 1;
  const isOnlySection = page.sections.length === 1;
  const isEmpty = section.items.length === 0;

  /**
   * Moves the section one place, and says so when the server refuses.
   *
   * @param toIndex - Where it goes.
   */
  const move = (toIndex: number): void => {
    moveSection.mutate(
      { pageSlug: page.slug, id: section.id, toIndex },
      { onError: (error) => toast(`Couldn't move ${label}. ${messageOf(error) ?? ''}`.trim()) },
    );
  };

  /** Removes the section and its items, and says so when the server refuses. */
  const remove = (): void => {
    removeSection.mutate(
      { pageSlug: page.slug, id: section.id },
      { onError: (error) => toast(`Couldn't remove ${label}. ${messageOf(error) ?? ''}`.trim()) },
    );
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`} iconSlot={<Ellipsis />} />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem iconSlot={<Plus />} label="Add item here" onSelect={onAddItem} />
          <MenuItem
            iconSlot={<Pencil />}
            label="Edit section"
            onSelect={() => setEditSession((count) => (count ?? 0) + 1)}
          />
          <MenuItem iconSlot={<ArrowUp />} label="Move up" disabled={isFirst} onSelect={() => move(index - 1)} />
          <MenuItem iconSlot={<ArrowDown />} label="Move down" disabled={isLast} onSelect={() => move(index + 1)} />
          {isOnlySection ? null : (
            <>
              <MenuSeparator />
              <MenuItem
                iconSlot={<Trash2 />}
                label="Remove section"
                destructive
                onSelect={() => (isEmpty ? remove() : setIsConfirmingRemove(true))}
              />
            </>
          )}
        </MenuContent>
      </Menu>
      {editSession === null ? null : (
        <SectionDialog
          key={editSession}
          open
          onOpenChange={(isOpen) => {
            if (isOpen === false) {
              setEditSession(null);
            }
          }}
          page={page}
          section={section}
        />
      )}
      <ConfirmDialog
        open={isConfirmingRemove}
        onOpenChange={setIsConfirmingRemove}
        title={`Remove ${label}?`}
        description={`The section and its ${itemCount(section)} come off ${page.title}. To keep an item, move it to another section first.`}
        confirmLabel="Remove section"
        onConfirm={remove}
      />
    </>
  );
}

import { usePages } from '@/pages/use-pages';
import { useAccess } from './use-access';

/** A group the "Who can see it" field suggests. */
export interface GroupOption {
  value: string;
  label: string;
}

/**
 * The groups worth suggesting: the editor's own, and every group a page, section or item already names.
 * Any other name can still be typed.
 *
 * @returns The groups, sorted, each once.
 */
export function useKnownGroups(): GroupOption[] {
  const pages = usePages().data ?? [];
  const viewerGroups = useAccess().data?.viewer?.groups ?? [];
  const named = pages.flatMap((page) => [
    ...page.visibleTo,
    ...page.sections.flatMap((section) => [...section.visibleTo, ...section.items.flatMap((item) => item.visibleTo)]),
  ]);
  const groups = [...new Set([...viewerGroups, ...named])].sort((a, b) => a.localeCompare(b));
  return groups.map((group) => ({ value: group, label: group }));
}

/** What the field says about itself, the same in every dialog. */
export const VISIBLE_TO_COPY = Object.freeze({
  label: 'Who can see it',
  description: 'Only people in these groups, and editors, can see it. Leave it empty for everyone.',
  placeholder: 'Everyone',
  createLabel: 'Add group',
});

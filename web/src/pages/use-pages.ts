import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AddItemDocument,
  AddSectionDocument,
  CreatePageDocument,
  type CreatePageInput,
  DeletePageDocument,
  type ItemFieldsFragment,
  type ItemInput,
  MoveItemDocument,
  MoveItemToPageDocument,
  MovePageDocument,
  MoveSectionDocument,
  type PageFieldsFragment,
  PageLimitsDocument,
  PagesDocument,
  RemoveItemDocument,
  RemoveSectionDocument,
  type SectionFieldsFragment,
  type SectionInput,
  UpdateItemDocument,
  UpdatePageDocument,
  type UpdatePageInput,
  UpdateSectionDocument,
} from '@/__generated__/graphql';
import { request } from '@/core/gql';
import { DISCOVERED_KEY } from '@/discovery/keys';

/** A page as the app holds it. */
export type Page = PageFieldsFragment;
/** An item on a page. */
export type Item = ItemFieldsFragment;
/** A group of items on a page, with an optional heading. */
export type Section = SectionFieldsFragment;

/** The one query every page view reads: all pages, with their items. */
export const PAGES_KEY = ['pages'] as const;
const PAGE_LIMITS_KEY = ['pageLimits'] as const;

/**
 * Every page, home first.
 *
 * @returns The query.
 */
export function usePages() {
  return useQuery({ queryKey: PAGES_KEY, queryFn: async () => (await request(PagesDocument)).pages });
}

/**
 * The limits the server checks every write against, for the forms to check first.
 *
 * @returns The query. The limits do not change while the server runs.
 */
export function usePageLimits() {
  return useQuery({
    queryKey: PAGE_LIMITS_KEY,
    queryFn: async () => (await request(PageLimitsDocument)).pageLimits,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Puts a page the server sent back into the cached list, in place, or at the end when it is new.
 *
 * @param client - The query client.
 * @param page - The page as the server now has it.
 */
function writePage(client: QueryClient, page: Page): void {
  client.setQueryData<Page[]>(PAGES_KEY, (pages = []) => {
    const isKnown = pages.some((known) => known.slug === page.slug);
    if (isKnown) {
      return pages.map((known) => (known.slug === page.slug ? page : known));
    }
    return [...pages, page];
  });
  // An item added from, or unlinked from, a discovered app changes where that app says it is.
  void client.invalidateQueries({ queryKey: DISCOVERED_KEY });
}

/**
 * Adds a page.
 *
 * @returns The mutation; it resolves to the new page.
 */
export function useCreatePage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePageInput) => (await request(CreatePageDocument, { input })).createPage,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Changes a page's title or icon.
 *
 * @returns The mutation.
 */
export function useUpdatePage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { slug: string; input: UpdatePageInput }) =>
      (await request(UpdatePageDocument, vars)).updatePage,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Deletes a page and its items.
 *
 * @returns The mutation; it resolves to the deleted page's slug.
 */
export function useDeletePage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => (await request(DeletePageDocument, { slug })).deletePage,
    onSuccess: (slug) =>
      client.setQueryData<Page[]>(PAGES_KEY, (pages = []) => pages.filter((page) => page.slug !== slug)),
  });
}

/**
 * Moves a page within the list.
 *
 * @returns The mutation.
 */
export function useMovePage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { slug: string; toIndex: number }) => (await request(MovePageDocument, vars)).movePage,
    onSuccess: (pages) => client.setQueryData(PAGES_KEY, pages),
  });
}

/**
 * Adds a section at the end of a page.
 *
 * @returns The mutation; it resolves to the page.
 */
export function useAddSection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; input: SectionInput }) =>
      (await request(AddSectionDocument, vars)).addSection,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Changes a section's heading or whether it starts folded.
 *
 * @returns The mutation; it resolves to the page.
 */
export function useUpdateSection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; id: string; input: SectionInput }) =>
      (await request(UpdateSectionDocument, vars)).updateSection,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Removes a section and its items.
 *
 * @returns The mutation; it resolves to the page.
 */
export function useRemoveSection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; id: string }) =>
      (await request(RemoveSectionDocument, vars)).removeSection,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Moves a section within its page.
 *
 * @returns The mutation; it resolves to the page.
 */
export function useMoveSection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; id: string; toIndex: number }) =>
      (await request(MoveSectionDocument, vars)).moveSection,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Adds an item at the end of a section.
 *
 * @returns The mutation.
 */
export function useAddItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; sectionId?: string | null; input: ItemInput }) =>
      (await request(AddItemDocument, vars)).addItem,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Replaces an item's fields.
 *
 * @returns The mutation.
 */
export function useUpdateItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; id: string; input: ItemInput }) =>
      (await request(UpdateItemDocument, vars)).updateItem,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Removes an item from its page.
 *
 * @returns The mutation.
 */
export function useRemoveItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; id: string }) => (await request(RemoveItemDocument, vars)).removeItem,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Moves an item within its section, or into another one.
 *
 * @returns The mutation.
 */
export function useMoveItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; id: string; toSectionId?: string | null; toIndex: number }) =>
      (await request(MoveItemDocument, vars)).moveItem,
    onSuccess: (page) => writePage(client, page),
  });
}

/**
 * Moves an item to another page, into a section there (that page's first when left out).
 *
 * @returns The mutation. Its result holds both pages, already written to the cache, and the item's id
 * where it landed.
 */
export function useMoveItemToPage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { pageSlug: string; id: string; toPageSlug: string; toSectionId?: string | null }) =>
      (await request(MoveItemToPageDocument, vars)).moveItemToPage,
    onSuccess: ({ from, to }) => {
      writePage(client, from);
      writePage(client, to);
    },
  });
}

/**
 * Finds a page in the list.
 *
 * @param pages - Every page.
 * @param slug - The page's slug.
 * @returns The page, or undefined when there is none.
 */
export function findPage(pages: readonly Page[], slug: string): Page | undefined {
  return pages.find((page) => page.slug === slug);
}

/** An item with an address: every link and frame, and a widget whose title links somewhere. */
export type AddressedItem = Item & { url: string };

/**
 * Checks whether an item has an address to open or frame.
 *
 * @param item - The item.
 * @returns True when it has one; only a widget may not.
 */
export function hasAddress(item: Item): item is AddressedItem {
  return item.url !== null;
}

/**
 * Finds an item on a page that can be opened or framed.
 *
 * @param page - The page, or undefined when there is none.
 * @param itemId - The item's id.
 * @returns The item, or undefined when the page has no such item or it has no address.
 */
export function findAddressedItem(page: Page | undefined, itemId: string): AddressedItem | undefined {
  return page?.items.filter(hasAddress).find((candidate) => candidate.id === itemId);
}

/**
 * Names a section for a picker or a question, including one with no heading.
 *
 * @param section - The section.
 * @returns Its title, or a stand-in for an untitled one.
 */
export function sectionLabel(section: Section): string {
  return section.title ?? 'Untitled section';
}

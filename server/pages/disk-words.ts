// How the YAML store writes and reads vocabulary words: lower case with hyphens on disk (`new-tab`), any
// case when read, upper case with underscores in the model (`NEW_TAB`).
import { z } from 'zod';

/**
 * Writes a vocabulary member the way a person would type it in the file.
 *
 * @param value - The member, in upper case.
 * @returns It in lower case, hyphens for underscores.
 */
export function toDiskWord(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

/**
 * A vocabulary member as written on disk: any case, hyphens for underscores.
 *
 * @typeParam T - The vocabulary's values.
 * @param values - The vocabulary's values, in upper case.
 * @returns A schema reading `film` or `FILM` as `FILM`.
 */
export function diskWord<T extends string>(values: readonly T[]) {
  const isMember = (value: string): value is T => values.some((member) => member === value);
  return z
    .string()
    .transform((value) => value.trim().toUpperCase().replaceAll('-', '_'))
    .refine(isMember, { message: `must be one of ${values.map(toDiskWord).join(', ')}` });
}

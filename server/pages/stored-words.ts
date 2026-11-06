// How vocabulary words are stored inside JSON columns (a widget's settings): lower case with hyphens
// (`new-tab`), read in any case, upper case with underscores in the model (`NEW_TAB`).
import { z } from 'zod';

/**
 * Writes a vocabulary member the way it is stored.
 *
 * @param value - The member, in upper case.
 * @returns It in lower case, hyphens for underscores.
 */
export function toStoredWord(value: string): string {
  return value.toLowerCase().replaceAll('_', '-');
}

/**
 * A vocabulary member as stored: any case, hyphens for underscores.
 *
 * @typeParam T - The vocabulary's values.
 * @param values - The vocabulary's values, in upper case.
 * @returns A schema reading `film` or `FILM` as `FILM`.
 */
export function storedWord<T extends string>(values: readonly T[]) {
  const isMember = (value: string): value is T => values.some((member) => member === value);
  return z
    .string()
    .transform((value) => value.trim().toUpperCase().replaceAll('-', '_'))
    .refine(isMember, { message: `must be one of ${values.map(toStoredWord).join(', ')}` });
}

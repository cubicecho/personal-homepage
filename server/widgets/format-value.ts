// Writes the values a JSONPath picked out of an API's answer in a field's format, and says whether they
// pass its warning thresholds.
import { MINUTES_PER_HOUR, MS_PER_SECOND, SECONDS_PER_MINUTE } from '../core/wire.ts';
import { ValueFormat } from '../pages/widget.ts';

/** What a row shows when the path reaches nothing. */
export const MISSING_VALUE = '—';
/** What several values are joined with. */
const LIST_SEPARATOR = ', ';
/** Bytes in a kibibyte. */
const BYTES_PER_KIB = 1024;
/** The units bytes are written in, smallest first. */
const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
/** Seconds in an hour. */
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
/** Hours in a day. */
const HOURS_PER_DAY = 24;
/** Seconds in a day. */
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;
/** A number below this is taken as seconds since 1970, at or above it as milliseconds (it is the year 33658 in seconds). */
const MILLISECOND_EPOCH_FROM = 1e12;
/** Characters of `YYYY-MM-DD HH:MM` in an ISO time. */
const ISO_MINUTES_LENGTH = 16;
/** Digits after the point for a percentage or a size. */
const FRACTION_DIGITS = 1;

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: FRACTION_DIGITS });

/**
 * Reads a value as a number.
 *
 * @param value - A value from the answer.
 * @returns The number, or null when it isn't one and isn't a numeric string.
 */
export function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const isNumericText = typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
  return isNumericText ? Number(value) : null;
}

/**
 * Writes a count of bytes in the largest unit that keeps it at or above one.
 *
 * @param bytes - The count.
 * @returns For example `1.5 GiB`.
 */
function formatBytes(bytes: number): string {
  let size = Math.abs(bytes);
  let unit = 0;
  while (size >= BYTES_PER_KIB && unit < BYTE_UNITS.length - 1) {
    size /= BYTES_PER_KIB;
    unit += 1;
  }
  const sign = bytes < 0 ? '-' : '';
  return `${sign}${oneDecimal.format(size)} ${BYTE_UNITS[unit]}`;
}

/**
 * Writes a number of seconds as days, hours, minutes and seconds, keeping the two largest parts.
 *
 * @param totalSeconds - The seconds.
 * @returns For example `2h 5m`.
 */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(Math.abs(totalSeconds));
  const parts = [
    [Math.floor(seconds / SECONDS_PER_DAY), 'd'],
    [Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR), 'h'],
    [Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE), 'm'],
    [seconds % SECONDS_PER_MINUTE, 's'],
  ] as const;
  const shown = parts.filter(([amount]) => amount > 0).slice(0, 2);
  return shown.length === 0 ? '0s' : shown.map(([amount, unit]) => `${amount}${unit}`).join(' ');
}

/**
 * Writes a date as `YYYY-MM-DD HH:MM` in UTC.
 *
 * @param value - An ISO string, or seconds or milliseconds since 1970.
 * @returns The date, or the value as text when it isn't one.
 */
function formatDate(value: unknown): string {
  const number = numberOf(value);
  let time = Number.NaN;
  if (number !== null) {
    time = number >= MILLISECOND_EPOCH_FROM ? number : number * MS_PER_SECOND;
  } else if (typeof value === 'string') {
    time = Date.parse(value);
  }
  if (Number.isNaN(time)) {
    return String(value);
  }
  return `${new Date(time).toISOString().slice(0, ISO_MINUTES_LENGTH).replace('T', ' ')} UTC`;
}

/**
 * Writes one value in a format.
 *
 * @param value - A value from the answer.
 * @param format - How to write it.
 * @returns The value as text. A value that doesn't fit a number format is written as text.
 */
function formatOne(value: unknown, format: ValueFormat): string {
  if (value === null || value === undefined) {
    return MISSING_VALUE;
  }
  if (format === ValueFormat.Date) {
    return formatDate(value);
  }
  const number = numberOf(value);
  const isObject = typeof value === 'object';
  if (number === null || format === ValueFormat.Text) {
    return isObject ? JSON.stringify(value) : String(value);
  }
  if (format === ValueFormat.Bytes) {
    return formatBytes(number);
  }
  if (format === ValueFormat.Percent) {
    return `${oneDecimal.format(number)}%`;
  }
  if (format === ValueFormat.Duration) {
    return formatDuration(number);
  }
  return numberFormat.format(number);
}

/**
 * Writes the values a path reached in a format.
 *
 * @param values - Every value the path reached.
 * @param format - How to write them.
 * @param maxChars - The longest text to give.
 * @returns One value as it is, several joined by commas, none as a dash; cut short at `maxChars`.
 */
export function formatValues(values: readonly unknown[], format: ValueFormat, maxChars: number): string {
  const text =
    values.length === 0 ? MISSING_VALUE : values.map((value) => formatOne(value, format)).join(LIST_SEPARATOR);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/**
 * Says whether a value is past a field's thresholds.
 *
 * @param values - Every value the path reached; only a single number is compared.
 * @param warnAbove - Mark it when above this.
 * @param warnBelow - Mark it when below this.
 * @returns Whether to mark it.
 */
export function isPastThreshold(
  values: readonly unknown[],
  warnAbove: number | null,
  warnBelow: number | null,
): boolean {
  const number = values.length === 1 ? numberOf(values[0]) : null;
  if (number === null) {
    return false;
  }
  const isAbove = warnAbove !== null && number > warnAbove;
  const isBelow = warnBelow !== null && number < warnBelow;
  return isAbove || isBelow;
}

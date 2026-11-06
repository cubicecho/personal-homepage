// The part of JSONPath an API widget needs to pick a value out of an answer, written by hand so the
// server takes no dependency for it:
//
//   $                     the whole answer
//   $.totalRecords        a key; $['total records'] for a key that isn't a plain name
//   $.records[0].title    an index; negative counts from the end: $.records[-1]
//   $.records[*].title    every element, giving several values
//   $.records.length      the length of an array (or of a string), when it has no "length" key
//
// Filters, slices, recursive descent (`..`) and scripts are not supported, and a path using them is refused
// when the widget is saved.

/** One step of a parsed path. */
type Step = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'all' };

/** A plain key after a dot: letters, digits, `_` and `$`, and `-` after the first character. */
const DOT_KEY = /^[A-Za-z_$][\w$-]*/;
/** An index in brackets: `[0]`, `[-1]`. */
const BRACKET_INDEX = /^\[(-?\d+)\]/;
/** A quoted key in brackets: `['a b']` or `["a b"]`. */
const BRACKET_KEY = /^\[(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\]/;
/** Every element: `[*]` or `.*`. */
const ALL = /^(?:\[\*\]|\.\*)/;
/** The key that gives an array's length when the array has no such key. */
const LENGTH_KEY = 'length';
/** Backslash escapes inside a quoted key. */
const QUOTED_ESCAPE = /\\(.)/g;

/** Why a path could not be read. */
export class JsonPathError extends Error {}

/**
 * Reads a JSONPath into steps.
 *
 * @param path - The path, starting with `$`.
 * @returns The steps after `$`.
 * @throws JsonPathError when the path uses something this reader doesn't support, saying where.
 */
export function parseJsonPath(path: string): Step[] {
  const text = path.trim();
  if (text.startsWith('$') === false) {
    throw new JsonPathError('A path starts with $, for example $.totalRecords.');
  }
  const steps: Step[] = [];
  let rest = text.slice(1);
  while (rest !== '') {
    const all = ALL.exec(rest);
    if (all !== null) {
      steps.push({ kind: 'all' });
      rest = rest.slice(all[0].length);
      continue;
    }
    const index = BRACKET_INDEX.exec(rest);
    if (index !== null) {
      steps.push({ kind: 'index', index: Number(index[1]) });
      rest = rest.slice(index[0].length);
      continue;
    }
    const quoted = BRACKET_KEY.exec(rest);
    if (quoted !== null) {
      const raw = quoted[1] ?? quoted[2] ?? '';
      steps.push({ kind: 'key', key: raw.replace(QUOTED_ESCAPE, '$1') });
      rest = rest.slice(quoted[0].length);
      continue;
    }
    const isDotStep = rest.startsWith('.') && rest.startsWith('..') === false;
    const key = isDotStep ? DOT_KEY.exec(rest.slice(1)) : null;
    if (key !== null) {
      steps.push({ kind: 'key', key: key[0] });
      rest = rest.slice(1 + key[0].length);
      continue;
    }
    throw new JsonPathError(`The path can't be read from "${rest}". Use .key, ['key'], [0] or [*].`);
  }
  return steps;
}

/**
 * Takes one step from every value reached so far.
 *
 * @param values - The values reached.
 * @param step - The step.
 * @returns The values the step reaches; missing keys and indexes reach nothing.
 */
function takeStep(values: unknown[], step: Step): unknown[] {
  return values.flatMap((value): unknown[] => {
    if (step.kind === 'all') {
      if (Array.isArray(value)) {
        return value;
      }
      return value !== null && typeof value === 'object' ? Object.values(value) : [];
    }
    if (step.kind === 'index') {
      if (Array.isArray(value) === false) {
        return [];
      }
      const at = step.index < 0 ? value.length + step.index : step.index;
      return at in value ? [value[at]] : [];
    }
    const isObject = value !== null && typeof value === 'object';
    if (isObject && Object.hasOwn(value, step.key)) {
      const picked: unknown = Reflect.get(value, step.key);
      return [picked];
    }
    const hasLength = Array.isArray(value) || typeof value === 'string';
    if (step.key === LENGTH_KEY && hasLength) {
      return [value.length];
    }
    return [];
  });
}

/**
 * Picks the values a path reaches in a JSON answer.
 *
 * @param data - The parsed answer.
 * @param path - The path.
 * @returns Every value reached, in order; empty when the path reaches nothing.
 * @throws JsonPathError when the path can't be read.
 */
export function selectJsonPath(data: unknown, path: string): unknown[] {
  return parseJsonPath(path).reduce(takeStep, [data]);
}

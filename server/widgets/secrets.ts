// Secret references in a widget's URL, headers and body: `${env:HOMEPAGE_SONARR_KEY}` and
// `${file:/run/secrets/sonarr}`. They are replaced only here, at fetch time, and what they resolve to
// is kept so every message that leaves a fetch can be scrubbed of it.
//
// The page files and the API only ever hold the reference. Since anyone who can reach the homepage can
// edit a widget, references are limited: an env name must start with `secretEnvPrefix`, and a file must
// sit in `<dataDir>/secrets` or one of `secretFileDirs`. Otherwise a widget could send any variable or
// readable file to an address of its choosing.
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '../core/errors.ts';
import { SECRET_REFERENCE } from '../pages/widget.ts';
import { WidgetError } from './widget-result.ts';

/** What stands in for a secret in a message. */
const REDACTED = '[secret]';
/** The kinds of reference. */
const ENV_REFERENCE = 'env';

/** Where secrets come from. Tests pass their own. */
export interface SecretSource {
  /** The environment, as `process.env`. */
  env: Readonly<Record<string, string | undefined>>;
  /** Reads a file whole, as text. */
  readFile: (file: string) => Promise<string>;
  /** What an env reference's name must start with. */
  envPrefix: string;
  /** The directories file references may point into. */
  fileDirs: readonly string[];
  /** Largest file read, in bytes. */
  maxFileBytes: number;
}

/** Fills in a widget's secret references, remembering what they resolved to. */
export interface SecretResolver {
  /**
   * Replaces the secret references in a text.
   *
   * @param text - The text as written.
   * @returns The text with each reference replaced by its secret.
   * @throws WidgetError when a reference names a variable that isn't set, a file that can't be read, or
   * one outside what widgets may read. The message names the reference, never a value.
   */
  resolve(text: string): Promise<string>;
  /**
   * Takes every secret this resolver has filled in out of a message.
   *
   * @param message - A message about the fetch.
   * @returns The message with each secret replaced by `[secret]`.
   */
  redact(message: string): string;
}

/**
 * Checks that a file lies inside one of the allowed directories, after following links.
 *
 * @param file - The file named in the reference.
 * @param dirs - The allowed directories.
 * @returns The real path of the file.
 * @throws WidgetError when it is not absolute, can't be found, or lies outside them.
 */
async function allowedFile(file: string, dirs: readonly string[]): Promise<string> {
  if (path.isAbsolute(file) === false) {
    throw new WidgetError(`The secret file ${file} must be an absolute path.`);
  }
  let real: string;
  try {
    real = await realpath(file);
  } catch {
    throw new WidgetError(`The secret file ${file} can't be read.`);
  }
  const realDirs = await Promise.all(dirs.map((dir) => realpath(dir).catch(() => null)));
  const isInside = realDirs.some((dir) => dir !== null && real.startsWith(`${dir}${path.sep}`));
  if (isInside === false) {
    throw new WidgetError(`The secret file ${file} isn't in a secrets directory (${dirs.join(', ')}).`);
  }
  return real;
}

/**
 * Builds a resolver for one fetch.
 *
 * @param source - Where secrets come from.
 * @returns The resolver.
 */
export function createSecretResolver(source: SecretSource): SecretResolver {
  const resolved: string[] = [];

  /**
   * Reads one reference's secret.
   *
   * @param kind - `env` or `file`.
   * @param name - The variable's name or the file's path.
   * @returns The secret.
   */
  const readSecret = async (kind: string, name: string): Promise<string> => {
    if (kind === ENV_REFERENCE) {
      if (name.startsWith(source.envPrefix) === false) {
        throw new WidgetError(
          `The secret ${name} must be named ${source.envPrefix}…, so widgets can't read other variables.`,
        );
      }
      const value = source.env[name];
      if (value === undefined || value === '') {
        throw new WidgetError(`The environment variable ${name} is not set.`);
      }
      return value;
    }
    const file = await allowedFile(name, source.fileDirs);
    let text: string;
    try {
      text = await source.readFile(file);
    } catch (error) {
      throw new WidgetError(`The secret file ${name} can't be read: ${errorMessage(error)}`);
    }
    if (text.length > source.maxFileBytes) {
      throw new WidgetError(`The secret file ${name} is too large to be a secret.`);
    }
    // Secret files usually end in a newline nobody means to send.
    return text.trim();
  };

  return {
    resolve: async (text) => {
      const references = [...text.matchAll(SECRET_REFERENCE)];
      let filled = text;
      for (const [reference, kind = '', name = ''] of references) {
        const secret = await readSecret(kind, name.trim());
        resolved.push(secret);
        filled = filled.replace(reference, () => secret);
      }
      return filled;
    },
    redact: (message) =>
      resolved
        .filter((secret) => secret !== '')
        .reduce((scrubbed, secret) => scrubbed.replaceAll(secret, REDACTED), message),
  };
}

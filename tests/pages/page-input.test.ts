import { GraphQLError } from 'graphql';
import { PAGE_LIMIT_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import { Icon, ItemKind } from '../../server/pages/page.ts';
import { parseItemFields, parseNewPage, parsePagePatch } from '../../server/pages/page-input.ts';

/**
 * Runs a parse that should fail and returns its error code.
 *
 * @param parse - The parse.
 * @returns The thrown error's `extensions.code`.
 */
function codeOf(parse: () => unknown): unknown {
  try {
    parse();
  } catch (error) {
    if (error instanceof GraphQLError) {
      return error.extensions.code;
    }
    throw error;
  }
  throw new Error('expected the parse to fail');
}

const link = { kind: ItemKind.Link, title: 'Jellyfin', url: 'http://nas.local:8096' };

describe('parseItemFields', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/relative/path',
    'nas.local:8096',
    'ftp://nas.local',
  ])('refuses %s', (url) => {
    expect(codeOf(() => parseItemFields({ ...link, url }))).toBe(ErrorCode.BadUserInput);
  });

  it('trims text and makes a blank description null', () => {
    const fields = parseItemFields({ ...link, title: '  Jellyfin  ', url: ' https://jf.local ', description: '   ' });
    expect(fields).toEqual({
      kind: ItemKind.Link,
      title: 'Jellyfin',
      url: 'https://jf.local',
      icon: null,
      description: null,
      frameHeightPx: null,
    });
  });

  it('gives a frame the default height and other kinds none', () => {
    expect(parseItemFields({ ...link, kind: ItemKind.Frame }).frameHeightPx).toBe(
      PAGE_LIMIT_DEFAULTS.defaultFrameHeightPx,
    );
    expect(parseItemFields({ ...link, kind: ItemKind.App, frameHeightPx: 300 }).frameHeightPx).toBeNull();
  });

  it('keeps a frame height inside the limits', () => {
    const { minFrameHeightPx, maxFrameHeightPx } = PAGE_LIMIT_DEFAULTS;
    expect(parseItemFields({ ...link, kind: ItemKind.Frame, frameHeightPx: maxFrameHeightPx }).frameHeightPx).toBe(
      maxFrameHeightPx,
    );
    expect(codeOf(() => parseItemFields({ ...link, kind: ItemKind.Frame, frameHeightPx: minFrameHeightPx - 1 }))).toBe(
      ErrorCode.BadUserInput,
    );
  });

  it('refuses a blank or over-long title, and an unknown icon', () => {
    expect(codeOf(() => parseItemFields({ ...link, title: '  ' }))).toBe(ErrorCode.BadUserInput);
    const tooLong = 'x'.repeat(PAGE_LIMIT_DEFAULTS.maxTitleLength + 1);
    expect(codeOf(() => parseItemFields({ ...link, title: tooLong }))).toBe(ErrorCode.BadUserInput);
    expect(codeOf(() => parseItemFields({ ...link, icon: 'NOPE' }))).toBe(ErrorCode.BadUserInput);
  });

  it('names the field in the message', () => {
    expect(() => parseItemFields({ ...link, url: 'javascript:alert(1)' })).toThrow(/^url: /);
  });
});

describe('parseNewPage', () => {
  it('leaves a missing or blank slug for the store to make', () => {
    expect(parseNewPage({ title: 'Media' })).toEqual({ title: 'Media', icon: null });
    expect(parseNewPage({ title: 'Media', slug: null, icon: Icon.Film })).toEqual({ title: 'Media', icon: Icon.Film });
  });

  it('keeps a valid slug and refuses one that is not', () => {
    expect(parseNewPage({ title: 'Media', slug: 'media-server' }).slug).toBe('media-server');
    expect(codeOf(() => parseNewPage({ title: 'Media', slug: 'Media Server' }))).toBe(ErrorCode.BadUserInput);
    expect(codeOf(() => parseNewPage({ title: 'Media', slug: 'media--server' }))).toBe(ErrorCode.BadUserInput);
  });
});

describe('parsePagePatch', () => {
  it('holds only the keys that were sent', () => {
    expect(parsePagePatch({ title: ' Films ' })).toEqual({ title: 'Films' });
    expect(parsePagePatch({ icon: null })).toEqual({ icon: null });
    expect(parsePagePatch({})).toEqual({});
  });
});

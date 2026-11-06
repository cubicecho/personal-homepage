import { GraphQLError } from 'graphql';
import { PAGE_LIMIT_DEFAULTS } from '../../server/core/defaults.ts';
import { ErrorCode } from '../../server/core/errors.ts';
import { ItemKind, OpensIn } from '../../server/pages/page.ts';
import { parseItemFields, parseNewPage, parsePagePatch, parseSectionFields } from '../../server/pages/page-input.ts';

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
      opensIn: OpensIn.NewTab,
      icon: null,
      description: null,
      frameHeightPx: null,
      check: { enabled: true, url: null },
    });
  });

  it('gives a frame the default height and other kinds none', () => {
    expect(parseItemFields({ ...link, kind: ItemKind.Frame }).frameHeightPx).toBe(
      PAGE_LIMIT_DEFAULTS.defaultFrameHeightPx,
    );
    expect(parseItemFields({ ...link, frameHeightPx: 300 }).frameHeightPx).toBeNull();
  });

  it('gives a link a place to open and a frame none', () => {
    expect(parseItemFields({ ...link, opensIn: OpensIn.App }).opensIn).toBe(OpensIn.App);
    expect(parseItemFields({ ...link, kind: ItemKind.Frame, opensIn: OpensIn.App }).opensIn).toBeNull();
  });

  it('reads the status check: on by default, off, or another URL', () => {
    expect(parseItemFields({ ...link, checkEnabled: false }).check).toEqual({ enabled: false, url: null });
    expect(parseItemFields({ ...link, checkUrl: ' http://nas.local/health ' }).check).toEqual({
      enabled: true,
      url: 'http://nas.local/health',
    });
    expect(parseItemFields({ ...link, checkUrl: '' }).check).toEqual({ enabled: true, url: null });
    expect(codeOf(() => parseItemFields({ ...link, checkUrl: 'javascript:alert(1)' }))).toBe(ErrorCode.BadUserInput);
  });

  it.each([
    ['film', 'film'],
    ['FILM', 'film'],
    ['di:jellyfin', 'di:jellyfin'],
    ['SH:home-assistant', 'sh:home-assistant'],
    ['favicon', 'favicon'],
    ['https://cdn.example.com/Icon.png', 'https://cdn.example.com/Icon.png'],
  ])('accepts the icon %s as %s', (icon, expected) => {
    expect(parseItemFields({ ...link, icon }).icon).toBe(expected);
  });

  it.each(['nope', 'di:', 'xx:jellyfin', 'javascript:alert(1)'])('refuses the icon %s', (icon) => {
    expect(codeOf(() => parseItemFields({ ...link, icon }))).toBe(ErrorCode.BadUserInput);
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
    expect(parseNewPage({ title: 'Media', slug: null, icon: 'film' })).toEqual({ title: 'Media', icon: 'film' });
  });

  it('refuses favicon as a page icon: a page has no site', () => {
    expect(codeOf(() => parseNewPage({ title: 'Media', icon: 'favicon' }))).toBe(ErrorCode.BadUserInput);
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

describe('parseSectionFields', () => {
  it('makes a blank title null and folding default to open', () => {
    expect(parseSectionFields({ title: '  ' })).toEqual({ title: null, collapsed: false });
    expect(parseSectionFields({ title: ' Watch ', collapsed: true })).toEqual({ title: 'Watch', collapsed: true });
  });

  it('refuses an over-long title', () => {
    const tooLong = 'x'.repeat(PAGE_LIMIT_DEFAULTS.maxTitleLength + 1);
    expect(codeOf(() => parseSectionFields({ title: tooLong }))).toBe(ErrorCode.BadUserInput);
  });
});

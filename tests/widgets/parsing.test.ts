import { ValueFormat } from '../../server/pages/widget.ts';
import { parseFeed, plainText } from '../../server/widgets/feed-parse.ts';
import { formatValues, isPastThreshold, MISSING_VALUE } from '../../server/widgets/format-value.ts';
import { JsonPathError, selectJsonPath } from '../../server/widgets/json-path.ts';

const MAX_CHARS = 200;

describe('selectJsonPath', () => {
  const data = {
    totalRecords: 3,
    'odd key': 'yes',
    records: [{ title: 'A' }, { title: 'B' }, { title: 'C', length: 9 }],
  };

  it.each([
    ['$', [data]],
    ['$.totalRecords', [3]],
    ["$['odd key']", ['yes']],
    ['$.records[0].title', ['A']],
    ['$.records[-1].title', ['C']],
    ['$.records[*].title', ['A', 'B', 'C']],
    ['$.records.length', [3]],
    ['$.records[2].length', [9]],
    ['$.missing', []],
    ['$.records[9].title', []],
  ])('reads %s', (path, expected) => {
    expect(selectJsonPath(data, path)).toEqual(expected);
  });

  it.each(['totalRecords', '$..title', '$.records[?(@.title)]', '$.records[0:2]'])('refuses %s', (path) => {
    expect(() => selectJsonPath(data, path)).toThrow(JsonPathError);
  });
});

describe('formatValues', () => {
  it.each([
    [[1234567.891], ValueFormat.Number, '1,234,567.89'],
    [['42'], ValueFormat.Number, '42'],
    [[1536], ValueFormat.Bytes, '1.5 KiB'],
    [[5_368_709_120], ValueFormat.Bytes, '5 GiB'],
    [[42.25], ValueFormat.Percent, '42.3%'],
    [[7505], ValueFormat.Duration, '2h 5m'],
    [[0], ValueFormat.Duration, '0s'],
    [['2026-11-05T14:03:00Z'], ValueFormat.Date, '2026-11-05 14:03 UTC'],
    [[1_762_351_380], ValueFormat.Date, '2025-11-05 14:03 UTC'],
    [[{ a: 1 }], ValueFormat.Text, '{"a":1}'],
    [['not a number'], ValueFormat.Number, 'not a number'],
    [['A', 'B'], ValueFormat.Text, 'A, B'],
    [[], ValueFormat.Text, MISSING_VALUE],
    [[null], ValueFormat.Number, MISSING_VALUE],
  ])('writes %j as %s → %s', (values, format, expected) => {
    expect(formatValues(values, format, MAX_CHARS)).toBe(expected);
  });

  it('cuts a long value short', () => {
    expect(formatValues(['x'.repeat(50)], ValueFormat.Text, 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('isPastThreshold', () => {
  it('compares one number with either threshold', () => {
    expect(isPastThreshold([11], 10, null)).toBe(true);
    expect(isPastThreshold([10], 10, null)).toBe(false);
    expect(isPastThreshold(['2'], null, 5)).toBe(true);
    expect(isPastThreshold([1, 20], 10, null)).toBe(false);
    expect(isPastThreshold(['high'], 10, null)).toBe(false);
  });
});

describe('parseFeed', () => {
  const base = 'https://example.com/feed.xml';

  it('reads RSS 2.0, with CDATA, entities, relative links and dates', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <title>Example &amp; Co</title>
        <link>https://example.com/</link>
        <!-- <item><title>commented out</title></item> -->
        <item>
          <title><![CDATA[First <b>post</b>]]></title>
          <link>/posts/1</link>
          <pubDate>Wed, 05 Nov 2026 14:00:00 GMT</pubDate>
          <description>&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</description>
        </item>
        <item>
          <title>Second</title>
          <link>javascript:alert(1)</link>
          <guid isPermaLink="false">abc</guid>
        </item>
      </channel></rss>`;
    expect(parseFeed(xml, base, 10)).toEqual({
      title: 'Example & Co',
      entries: [
        {
          title: 'First post',
          url: 'https://example.com/posts/1',
          publishedAt: '2026-11-05T14:00:00.000Z',
          summary: 'Hello & welcome',
        },
        { title: 'Second', url: null, publishedAt: null, summary: null },
      ],
    });
  });

  it('reads Atom, preferring the alternate link', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
        <title type="text">Atom feed</title>
        <entry>
          <title>An entry</title>
          <link rel="self" href="https://example.com/self"/>
          <link rel="alternate" href="https://example.com/entry"/>
          <published>2026-11-05T10:00:00+01:00</published>
          <summary type="html">Short &lt;em&gt;summary&lt;/em&gt;</summary>
        </entry>
      </feed>`;
    expect(parseFeed(xml, base, 10).entries).toEqual([
      {
        title: 'An entry',
        url: 'https://example.com/entry',
        publishedAt: '2026-11-05T09:00:00.000Z',
        summary: 'Short summary',
      },
    ]);
  });

  it('stops at the limit, and gives nothing for something that is not a feed', () => {
    const items = Array.from({ length: 5 }, (_unused, index) => `<item><title>${index}</title></item>`).join('');
    expect(parseFeed(`<rss><channel>${items}</channel></rss>`, base, 2).entries).toHaveLength(2);
    expect(parseFeed('<html><body>hi</body></html>', base, 5)).toEqual({ title: null, entries: [] });
  });

  it('decodes numeric entities and drops tags', () => {
    expect(plainText('caf&#233; &#x2764; <b>bold</b>')).toBe('café ❤ bold');
  });
});

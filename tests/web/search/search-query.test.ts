import {
  addressFrom,
  type Engine,
  type MatchFields,
  parseQuery,
  rankMatches,
  scoreMatch,
  searchUrl,
} from '../../../web/src/search/search-query.ts';

const DUCK: Engine = { prefix: 'd', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}', isDefault: true };
const GOOGLE: Engine = {
  prefix: 'g',
  name: 'Google',
  url: 'https://www.google.com/search?q={query}',
  isDefault: false,
};
const ENGINES = [DUCK, GOOGLE];

describe('parseQuery', () => {
  it('reads blank text as empty', () => {
    expect(parseQuery('   ', ENGINES)).toEqual({ kind: 'empty' });
  });

  it('reads a known bang as a search on that engine', () => {
    expect(parseQuery('!g  cat videos ', ENGINES)).toEqual({ kind: 'bang', engine: GOOGLE, terms: 'cat videos' });
    expect(parseQuery('!G', ENGINES)).toEqual({ kind: 'bang', engine: GOOGLE, terms: '' });
  });

  it('reads an unknown bang as plain text', () => {
    expect(parseQuery('!x cats', ENGINES)).toEqual({ kind: 'text', text: '!x cats', url: null });
  });

  it('notices text that is an address', () => {
    expect(parseQuery('nas.local:8096', ENGINES)).toEqual({
      kind: 'text',
      text: 'nas.local:8096',
      url: 'http://nas.local:8096',
    });
  });
});

describe('addressFrom', () => {
  it.each([
    ['https://example.com/a?b=c', 'https://example.com/a?b=c'],
    ['nas.local', 'http://nas.local'],
    ['192.168.1.1:8080/admin', 'http://192.168.1.1:8080/admin'],
    ['localhost:3000', 'http://localhost:3000'],
    ['router:80', 'http://router:80'],
  ])('opens %s as %s', (text, url) => {
    expect(addressFrom(text)).toBe(url);
  });

  it.each(['jellyfin', 'cat videos', 'javascript:alert(1)', 'ftp://nas.local', '', 'a.'])(
    'does not open %s',
    (text) => {
      expect(addressFrom(text)).toBeNull();
    },
  );
});

describe('searchUrl', () => {
  it('puts the encoded terms where {query} is', () => {
    expect(searchUrl(DUCK, 'cats & dogs')).toBe('https://duckduckgo.com/?q=cats%20%26%20dogs');
  });
});

describe('scoreMatch and rankMatches', () => {
  const entries: { name: string; fields: MatchFields }[] = [
    { name: 'grafana', fields: { primary: 'Grafana', secondary: ['Dashboards', 'nas.local:3001', 'Tools'] } },
    { name: 'jellyfin', fields: { primary: 'Jellyfin', secondary: ['Films and shows', 'nas.local:8096', 'Media'] } },
    { name: 'jelly-app', fields: { primary: 'Jellyseerr', secondary: ['Requests', 'nas.local:5055', 'Media'] } },
    { name: 'router', fields: { primary: 'Router', secondary: ['Admin page', '192.168.1.1', 'Home'] } },
  ];
  const rank = (query: string) => rankMatches(entries, query, (entry) => entry.fields, 10).map((entry) => entry.name);

  it('needs every typed word to match somewhere', () => {
    expect(rank('jelly films')).toEqual(['jellyfin']);
    expect(rank('jelly nothing')).toEqual([]);
  });

  it('ranks the name above the other fields, and an exact name first', () => {
    expect(rank('media')).toEqual(['jellyfin', 'jelly-app']);
    expect(rank('jellyfin')).toEqual(['jellyfin']);
    expect(rank('jelly')).toEqual(['jellyfin', 'jelly-app']);
    expect(scoreMatch(entries[1]?.fields ?? { primary: '', secondary: [] }, 'Jellyfin')).toBeGreaterThan(
      scoreMatch(entries[2]?.fields ?? { primary: '', secondary: [] }, 'Jellyfin'),
    );
  });

  it('finds an item by its host and by letters in order', () => {
    expect(rank('8096')).toEqual(['jellyfin']);
    expect(rank('grfn')).toEqual(['grafana']);
  });

  it('keeps the list order for equal scores, and the limit', () => {
    expect(rank('nas')).toEqual(['grafana', 'jellyfin', 'jelly-app']);
    expect(rankMatches(entries, 'nas', (entry) => entry.fields, 2)).toHaveLength(2);
  });

  it('matches nothing for a blank query', () => {
    expect(rank('  ')).toEqual([]);
  });
});

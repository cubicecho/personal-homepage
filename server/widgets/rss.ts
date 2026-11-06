// The RSS widget: reads a feed's latest entries.
import { type RssWidgetSettings, WidgetType } from '../pages/widget.ts';
import { parseFeed } from './feed-parse.ts';
import { type FetchLimits, fetchBody, hostOf } from './fetch-body.ts';
import type { SecretResolver } from './secrets.ts';
import { type Fetched, WidgetError } from './widget-result.ts';

/** What the feed fetcher needs beyond the widget's own settings. */
export interface RssFetchDeps extends FetchLimits {
  secrets: SecretResolver;
  /** Longest summary an entry keeps, in characters. */
  maxSummaryChars: number;
}

/** The feed formats a server may say it is sending, and the generic XML ones. */
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

/**
 * Cuts a summary to a line's worth.
 *
 * @param summary - The summary as plain text.
 * @param maxChars - The longest it may be.
 * @returns It, cut at a word and marked with an ellipsis when it was longer.
 */
function shortSummary(summary: string, maxChars: number): string {
  if (summary.length <= maxChars) {
    return summary;
  }
  const cut = summary.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Reads an RSS widget's feed.
 *
 * @param settings - The widget's settings, as written.
 * @param deps - The fetch, its limits, and the secret resolver.
 * @returns The feed's title and its latest entries.
 * @throws WidgetError when the request fails, or the answer has no entries and doesn't look like a feed.
 */
export async function fetchRss(settings: RssWidgetSettings, deps: RssFetchDeps): Promise<Fetched> {
  const url = await deps.secrets.resolve(settings.url);
  const xml = await fetchBody({ url, writtenUrl: settings.url, init: { headers: { accept: FEED_ACCEPT } } }, deps);
  const feed = parseFeed(xml, url, settings.limit);
  const isFeed = feed.entries.length > 0 || /<(rss|feed|rdf:RDF)\b/i.test(xml);
  if (isFeed === false) {
    throw new WidgetError(`${hostOf(settings.url)} answered with something that isn't an RSS or Atom feed.`);
  }
  const entries = feed.entries.map((entry) => ({
    title: entry.title,
    url: entry.url,
    source: feed.title,
    publishedAt: entry.publishedAt,
    summary: settings.showSummary && entry.summary !== null ? shortSummary(entry.summary, deps.maxSummaryChars) : null,
  }));
  return { result: { type: WidgetType.Rss, feedTitle: feed.title, entries }, raw: null };
}

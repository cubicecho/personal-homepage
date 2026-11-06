import type { WidgetResultFieldsFragment } from '@/__generated__/graphql';
import { DescriptionList, PropertyRow } from '@/components/description-list';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { StatTile } from '@/components/stat-tile';
import { TriangleAlert } from '@/components/ui/icons';
import { timeAgo } from './use-widget-data';
import { weatherGlyph } from './widget-types';

type ApiResult = Extract<WidgetResultFieldsFragment, { __typename: 'ApiWidgetResult' }>;
type RssResult = Extract<WidgetResultFieldsFragment, { __typename: 'RssWidgetResult' }>;
type WeatherResult = Extract<WidgetResultFieldsFragment, { __typename: 'WeatherWidgetResult' }>;

/** The colour of a value past its threshold. Never alone: the row also gets a warning glyph and words. */
const WARN_CLASS = 'text-negative';

/**
 * A value past its threshold: the value in the warning colour, with a glyph and words beside it.
 *
 * @param props - The value.
 * @param props.value - The value as text.
 * @returns The marked value.
 */
function WarnedValue({ value }: { value: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${WARN_CLASS}`}>
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      {value}
      <span className="sr-only">, past its limit</span>
    </span>
  );
}

/**
 * An API widget's values: one large figure when there is one value, a list of label and value otherwise.
 *
 * @param props - The result.
 * @param props.result - The rows.
 * @returns The values.
 */
function ApiResultView({ result }: { result: ApiResult }) {
  const [only] = result.rows;
  if (result.rows.length === 1 && only !== undefined) {
    return (
      <StatTile
        label={only.label}
        value={only.warn ? <WarnedValue value={only.value} /> : only.value}
        className="border-0 bg-transparent p-0 shadow-none"
      />
    );
  }
  return (
    <DescriptionList
      contentSlot={result.rows.map((row) => (
        <PropertyRow
          key={row.label}
          label={row.label}
          value={row.warn ? <WarnedValue value={row.value} /> : row.value}
          valueClassName="tabular-nums"
        />
      ))}
    />
  );
}

/**
 * A feed's latest entries, each a link to the entry with how long ago it was published.
 *
 * @param props - The result.
 * @param props.result - The entries.
 * @param props.now - The time now, in milliseconds since 1970.
 * @returns The list.
 */
function RssResultView({ result, now }: { result: RssResult; now: number }) {
  if (result.entries.length === 0) {
    return <EmptyState compact title="The feed has no entries right now." />;
  }
  return (
    <List
      label={result.feedTitle ?? 'Feed entries'}
      contentSlot={result.entries.map((entry, index) => (
        <ListItem
          key={entry.url ?? `${entry.title}-${index}`}
          title={entry.title}
          description={entry.summary ?? undefined}
          meta={entry.publishedAt === null ? undefined : timeAgo(entry.publishedAt, now)}
          linkSlot={
            entry.url === null ? undefined : (
              // biome-ignore lint/a11y/useAnchorContent: ListItem draws the row's title and lines inside this link.
              <a href={entry.url} target="_blank" rel="noreferrer" />
            )
          }
        />
      ))}
    />
  );
}

/**
 * Writes a temperature with its unit.
 *
 * @param value - The temperature.
 * @param unit - `°C` or `°F`.
 * @returns For example `12°C`.
 */
function degrees(value: number, unit: string): string {
  return `${Math.round(value)}${unit}`;
}

/**
 * Writes an hour of the place's own time as the clock shows it.
 *
 * @param time - `YYYY-MM-DDTHH:MM`.
 * @returns `HH:MM`.
 */
function hourOf(time: string): string {
  return time.slice(time.indexOf('T') + 1);
}

/**
 * The weather now, today's high and low, and a row of the coming hours.
 *
 * @param props - The result.
 * @param props.result - The forecast.
 * @returns The weather.
 */
function WeatherResultView({ result }: { result: WeatherResult }) {
  const { now, temperatureUnit: unit } = result;
  const NowGlyph = weatherGlyph(now.weatherCode, now.isDay);
  const feelsLike = now.apparentTemperature === null ? null : `Feels like ${degrees(now.apparentTemperature, unit)}`;
  const highLow =
    result.high === null || result.low === null
      ? null
      : `High ${degrees(result.high, unit)}, low ${degrees(result.low, unit)}`;
  const wind = now.windSpeed === null ? null : `Wind ${Math.round(now.windSpeed)} ${result.windSpeedUnit}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <NowGlyph className="size-10 shrink-0 text-foreground/80" aria-hidden />
        <div className="flex flex-col">
          <span className="font-semibold text-3xl tabular-nums">{degrees(now.temperature, unit)}</span>
          <span className="text-sm">{now.description}</span>
        </div>
        <div className="flex flex-col text-foreground/60 text-sm">
          {[feelsLike, highLow, wind]
            .filter((line) => line !== null)
            .map((line) => (
              <span key={line}>{line}</span>
            ))}
        </div>
      </div>
      {result.hours.length === 0 ? null : (
        // One row of as many hours as fit the card, 4rem each at least: the rest sit on rows of no
        // height, clipped, so the strip never scrolls sideways. A screen reader still reads every hour.
        <ul
          aria-label="Coming hours"
          className="grid auto-rows-[0] grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] grid-rows-[auto] gap-x-2 overflow-hidden"
        >
          {result.hours.map((hour) => {
            const HourGlyph = weatherGlyph(hour.weatherCode, hour.isDay);
            const chance = hour.precipitationChance ?? 0;
            return (
              <li
                key={hour.time}
                className="flex min-w-0 flex-col items-center gap-1 rounded-md border border-foreground/10 px-1 py-1.5 text-xs"
              >
                <span className="text-foreground/60">{hourOf(hour.time)}</span>
                <HourGlyph className="size-5" aria-hidden />
                <span className="sr-only">{hour.description}</span>
                <span className="font-medium tabular-nums">{degrees(hour.temperature, unit)}</span>
                {chance > 0 ? <span className="text-foreground/60 tabular-nums">{Math.round(chance)}%</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface WidgetResultViewProps {
  result: WidgetResultFieldsFragment;
  /** The time now, in milliseconds since 1970, for how long ago feed entries were published. */
  now: number;
}

/** Whatever a widget shows, drawn for its type. */
export function WidgetResultView({ result, now }: WidgetResultViewProps) {
  if (result.__typename === 'ApiWidgetResult') {
    return <ApiResultView result={result} />;
  }
  if (result.__typename === 'RssWidgetResult') {
    return <RssResultView result={result} now={now} />;
  }
  return <WeatherResultView result={result} />;
}

import type { StatusState } from '@/__generated__/graphql';
import { CircleCheck, CircleQuestionMark, TriangleAlert } from '@/components/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Item } from '@/pages/use-pages';
import { type ItemStatus, useItemStatus } from './use-item-statuses';

interface ItemStatusDotProps {
  /** The page the item is on. */
  pageSlug: string;
  item: Item;
  /** Writes the state and the time it took beside the glyph, where there is room for it. */
  showLabel?: boolean;
}

/** How each state is drawn: a glyph of its own shape and a word, so colour is never the only signal. */
const STATES = {
  UP: { Glyph: CircleCheck, label: 'Up', ink: 'text-positive' },
  DOWN: { Glyph: TriangleAlert, label: 'Down', ink: 'text-negative' },
  UNKNOWN: { Glyph: CircleQuestionMark, label: 'Not checked yet', ink: 'text-foreground/50' },
} satisfies Record<StatusState, { Glyph: unknown; label: string; ink: string }>;

/** A full stop at the end of a line, dropped when lines are joined into one sentence. */
const TRAILING_STOP = /\.$/;

/**
 * Sums a status up on one line: its state, the HTTP status and how long it took.
 *
 * @param status - The status.
 * @returns For example "Up · HTTP 200 · 23 ms".
 */
function summary(status: ItemStatus): string {
  const parts = [STATES[status.state].label];
  if (status.httpStatus !== null) {
    parts.push(`HTTP ${status.httpStatus}`);
  }
  if (status.latencyMs !== null) {
    parts.push(`${status.latencyMs} ms`);
  }
  return parts.join(' · ');
}

/**
 * Says when a status was checked.
 *
 * @param checkedAt - The ISO time, or null.
 * @returns "Checked at 12:04:31", or null when it never was.
 */
function checkedLine(checkedAt: string | null): string | null {
  return checkedAt === null ? null : `Checked at ${new Date(checkedAt).toLocaleTimeString()}`;
}

/**
 * An item's status from the server's last check: a glyph whose shape says up, down or not yet,
 * with the details in a tooltip and in its accessible name. Nothing for an item that is not
 * checked, or before the first answer.
 */
export function ItemStatusDot({ pageSlug, item, showLabel = false }: ItemStatusDotProps) {
  const status = useItemStatus(pageSlug, item.id);
  if (item.checkEnabled === false || status === undefined) {
    return null;
  }
  const { Glyph, label, ink } = STATES[status.state];
  const lines = [summary(status), status.message, checkedLine(status.checkedAt)].filter(
    (line): line is string => line !== null,
  );
  const latency = status.latencyMs === null ? '' : ` · ${status.latencyMs} ms`;
  const spoken = lines.map((line) => line.replace(TRAILING_STOP, '')).join('. ');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${spoken}.`}
          className="flex shrink-0 items-center gap-1 rounded-md p-1 text-xs outline-none hover:bg-hover focus-visible:bg-hover"
        >
          <Glyph className={cn('size-4', ink)} aria-hidden />
          {showLabel ? (
            <span className="text-foreground/70" aria-hidden>
              {label}
              {status.state === 'UP' ? latency : ''}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

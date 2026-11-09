import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { CardLayout } from '@/components/card-layout';
import { EmptyState } from '@/components/empty-state';
import { List } from '@/components/list';
import { ListItem } from '@/components/list-item';
import { LoadState } from '@/components/load-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Ellipsis, Plus } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { Ban, ExternalLink, Radar, RefreshCw } from '@/core/app-icons';
import { iconElement } from '@/core/page-icons';
import { messageOf } from '@/lib/error-message';
import { timeAgo } from '@/widgets/use-widget-data';
import { AddDiscoveredDialog } from './add-discovered-dialog';
import {
  type DiscoveredApp,
  type DiscoverySource,
  useDiscoveredApps,
  useDiscoverySources,
  useDismissDiscoveredApp,
  useRescanDiscovery,
} from './use-discovery';

/** Where an app was found, in words. */
const SOURCE_LABELS = {
  MDNS: 'Announced on your network',
  DOCKHAND: 'Dockhand',
  DOCKER: 'Docker on this host',
} as const;

/** What each source is called in its status row. */
const SOURCE_NAMES = { MDNS: 'mDNS', DOCKHAND: 'Dockhand', DOCKER: 'Docker socket' } as const;

/**
 * Checks whether an app matches what was typed into the filter.
 *
 * @param app - The app.
 * @param filter - What was typed, lower-cased and trimmed.
 * @returns True when its name, address or description contains it.
 */
function matches(app: DiscoveredApp, filter: string): boolean {
  return [app.name, app.url, app.description ?? ''].some((text) => text.toLowerCase().includes(filter));
}

/**
 * Says how a source is doing, in a line.
 *
 * @param source - The source's status.
 * @param now - The time now, in milliseconds.
 * @returns How to set it up when it is off, why it failed, or what it found and when.
 */
function sourceLine(source: DiscoverySource, now: number): string {
  if (source.isEnabled === false) {
    return source.setupHint ?? 'Not set up.';
  }
  if (source.error !== null) {
    return source.error;
  }
  const when = source.lastScanAt === null ? 'not asked yet' : `asked ${timeAgo(source.lastScanAt, now)}`;
  return `${source.found} found, ${when}.`;
}

/**
 * Names a source's state in a word, beside the line that explains it.
 *
 * @param source - The source's status.
 * @returns On, Failing or Off.
 */
function sourceState(source: DiscoverySource): string {
  if (source.isEnabled === false) {
    return 'Off';
  }
  return source.error === null ? 'On' : 'Failing';
}

/**
 * How each source is doing, with how to set up those that aren't.
 *
 * @returns The card.
 */
function SourcesCard() {
  const sources = useDiscoverySources();
  const now = Date.now();
  return (
    <CardLayout
      title="Where apps are found"
      contentSlot={
        <List
          label="Discovery sources"
          contentSlot={(sources.data ?? []).map((source) => {
            const isWorking = source.isEnabled && source.error === null;
            return (
              <ListItem
                key={source.source}
                title={SOURCE_NAMES[source.source]}
                description={
                  source.error === null ? (
                    sourceLine(source, now)
                  ) : (
                    // An element, not a string, so the row doesn't clamp it to two lines: the whole
                    // sentence is what says what to change.
                    <span className="whitespace-normal break-words text-foreground/80 text-xs">{source.error}</span>
                  )
                }
                actionSlot={<Badge variant={isWorking ? 'positive' : 'default'}>{sourceState(source)}</Badge>}
              />
            );
          })}
        />
      }
    />
  );
}

/**
 * Says where an app was added, in one badge so a row keeps its room on a phone: "On Media" linking to the
 * page when it is on one, "On 3 pages" naming them in its tooltip when it is on several.
 *
 * @param props - The app.
 * @param props.app - The app.
 * @returns The badge, or nothing when it is on no page.
 */
function PlacementBadge({ app }: { app: DiscoveredApp }) {
  const pages = new Map(app.addedTo.map((placement) => [placement.pageSlug, placement.pageTitle]));
  const [only] = [...pages];
  if (only === undefined) {
    return null;
  }
  if (pages.size > 1) {
    return (
      <Badge variant="info" title={[...pages.values()].join(', ')}>
        On {pages.size} pages
      </Badge>
    );
  }
  const [slug, title] = only;
  return (
    <Badge asChild variant="info">
      {slug === 'home' ? (
        <Link to="/">On {title}</Link>
      ) : (
        <Link to="/pages/$slug" params={{ slug }}>
          On {title}
        </Link>
      )}
    </Badge>
  );
}

/**
 * One found app's row: what it is, where it was found, where it was added, and its menu.
 *
 * @param props - The app and what its menu does.
 * @param props.app - The app.
 * @param props.onAdd - Opens the dialog that adds it to a page.
 * @returns The row.
 */
function AppRow({ app, onAdd }: { app: DiscoveredApp; onAdd: () => void }) {
  const dismiss = useDismissDiscoveredApp();
  const toast = useToast();
  const host = URL.canParse(app.url) ? new URL(app.url).host : app.url;

  /** Dismisses the app or brings it back, saying so when the server refuses. */
  const toggleDismissed = (): void => {
    dismiss.mutate(
      { id: app.id, dismissed: app.dismissed === false },
      { onError: (error) => toast(`Couldn't change ${app.name}. ${messageOf(error) ?? ''}`.trim(), 'negative') },
    );
  };

  return (
    <ListItem
      title={app.dismissed ? `${app.name} (dismissed)` : app.name}
      leadingSlot={
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground/10 [&_svg]:size-5">
          {iconElement(app.icon, Radar, app.iconUrl)}
        </span>
      }
      description={`${host} · ${SOURCE_LABELS[app.source]} · last seen ${timeAgo(app.lastSeenAt, Date.now())}`}
      meta={<PlacementBadge app={app} />}
      actionSlot={
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label={`Actions for ${app.name}`} iconSlot={<Ellipsis />} />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem iconSlot={<Plus />} label="Add to page…" onSelect={onAdd} />
            <MenuItem
              iconSlot={<ExternalLink />}
              label="Open in the browser"
              linkSlot={<a href={app.url} target="_blank" rel="noreferrer" />}
            />
            <MenuItem iconSlot={<Ban />} label={app.dismissed ? 'Restore' : 'Dismiss'} onSelect={toggleDismissed} />
          </MenuContent>
        </Menu>
      }
    />
  );
}

/**
 * The Discovered apps section of Settings: what the server found on the network, to add to pages.
 *
 * @returns The section.
 */
export function DiscoveredAppsView() {
  const [filter, setFilter] = useState('');
  const [showDismissed, setShowDismissed] = useState(false);
  const dismissedSwitchId = useId();
  const [adding, setAdding] = useState<{ app: DiscoveredApp; session: number } | null>(null);
  const apps = useDiscoveredApps(showDismissed);
  const rescan = useRescanDiscovery();
  const toast = useToast();
  const needle = filter.trim().toLowerCase();
  const shown = (apps.data ?? []).filter((app) => needle === '' || matches(app, needle));

  /** Asks every source again, and says what came of it. */
  const runRescan = async (): Promise<void> => {
    try {
      const result = await rescan.mutateAsync();
      const fresh = result.added === 1 ? '1 new' : `${result.added} new`;
      toast(`Found ${result.found} ${result.found === 1 ? 'app' : 'apps'}, ${fresh}.`, 'positive');
    } catch (error) {
      toast(messageOf(error) ?? 'The rescan failed. Try again.', 'negative');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <CardLayout
        title="Discovered apps"
        description="Apps the server found on your network. Nothing here is on a page until you add it."
        actionSlot={
          <Button
            variant="outline"
            size="sm"
            iconSlot={<RefreshCw />}
            content="Rescan"
            loading={rescan.isPending}
            loadingLabel="Scanning…"
            onClick={() => void runRescan()}
          />
        }
        contentSlot={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="search"
                aria-label="Filter found apps"
                placeholder="Filter by name or address"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="min-w-0 flex-1"
              />
              <span className="flex items-center gap-2 text-sm">
                <Switch id={dismissedSwitchId} checked={showDismissed} onCheckedChange={setShowDismissed} />
                <label htmlFor={dismissedSwitchId}>Show dismissed</label>
              </span>
            </div>
            <LoadState
              query={apps}
              what="the apps found on your network"
              count={shown.length}
              emptySlot={
                <EmptyState
                  compact
                  title={
                    needle === ''
                      ? 'Nothing found yet. See below for where apps are looked for, then rescan.'
                      : 'No found app matches.'
                  }
                />
              }
            />
            <List
              label="Discovered apps"
              contentSlot={shown.map((app) => (
                <AppRow key={app.id} app={app} onAdd={() => setAdding({ app, session: (adding?.session ?? 0) + 1 })} />
              ))}
            />
          </div>
        }
      />
      <SourcesCard />
      {adding === null ? null : (
        <AddDiscoveredDialog
          key={adding.session}
          app={adding.app}
          open
          onOpenChange={(isOpen) => {
            if (isOpen === false) {
              setAdding(null);
            }
          }}
        />
      )}
    </div>
  );
}

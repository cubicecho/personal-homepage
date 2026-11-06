import type { FrameChecker } from '../frames/frame-check.ts';
import type { IconService } from '../icons/icon-service.ts';
import type { PageStore } from '../pages/page.ts';
import type { SiteSettings } from '../site/site-settings.ts';
import type { StatusChecker } from '../status/status-checker.ts';
import type { WidgetService } from '../widgets/widget-service.ts';

/** The services resolvers use, made once per process. */
export interface Services {
  /** Where pages are kept. */
  pages: PageStore;
  /** Checks items' status. */
  status: StatusChecker;
  /** Checks whether sites may be framed. */
  frames: FrameChecker;
  /** Resolves and searches icons. */
  icons: IconService;
  /** Site-wide settings that are not pages. */
  site: SiteSettings;
  /** Fetches widgets' data. */
  widgets: WidgetService;
}

/** What every resolver is given. */
export interface Context extends Services {}

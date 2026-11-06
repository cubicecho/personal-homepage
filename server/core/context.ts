import type { Access } from '../auth/access.ts';
import type { AuthHost } from '../auth/auth-host.ts';
import type { Auth } from '../auth/better-auth.ts';
import type { ForwardAuth } from '../auth/forward-auth.ts';
import type { IconLinks } from '../auth/icon-links.ts';
import type { RateLimiter } from '../auth/rate-limit.ts';
import type { Database } from '../db/client.ts';
import type { DiscoveryService } from '../discovery/service.ts';
import type { FrameChecker } from '../frames/frame-check.ts';
import type { IconService } from '../icons/icon-service.ts';
import type { PageStore } from '../pages/page.ts';
import type { SiteSettings } from '../site/site-settings.ts';
import type { StatusChecker } from '../status/status-checker.ts';
import type { WidgetService } from '../widgets/widget-service.ts';

/** What the client's address is when the socket reports none. One shared throttle budget, not none. */
export const UNKNOWN_IP = 'unknown';

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
  /** Finds apps on the network and keeps them as suggestions. */
  discovery: DiscoveryService;
  /** The database users, sessions and the OIDC pairing are kept in. */
  db: Database;
  /** Hands out the current better-auth instance. Pairing a provider rebuilds it while the server runs. */
  authHost: AuthHost;
  /** Reads the identity a trusted proxy passes on. */
  forwardAuth: ForwardAuth;
  /** The sign-in throttle. */
  limiter: RateLimiter;
}

/** What every resolver is given: the services, and who is asking. */
export interface Context extends Services {
  /** The better-auth instance for this request; the sign-in resolvers call `auth.api.*`. */
  auth: Auth;
  /** Who is asking and what they may do. Nothing downstream takes the caller from an argument. */
  access: Access;
  /** How icon addresses are signed for this request. */
  iconLinks: IconLinks;
  /** The request's headers: better-auth reads the session from them. */
  headers: Headers;
  /** The client's address as Express resolved it under TRUST_PROXY, for the throttle. */
  ip: string;
}

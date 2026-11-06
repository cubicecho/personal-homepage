import {
  BookOpen,
  Camera,
  ChartLine,
  Cloud,
  Code,
  Database,
  Film,
  Gamepad2,
  Globe,
  House,
  Image,
  Mail,
  Music,
  Printer,
  Router,
  Server,
  Shield,
  SquareKanban,
  Terminal,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import type { Icon } from '@/__generated__/graphql';
import { Calendar, Download, type IconProps, Settings } from '@/components/ui/icons';

/** A glyph component, as lucide and `@cubeui/icons` both export them. */
type Glyph = (props: IconProps) => ReactNode;

/** How one `Icon` value is drawn, and what it is called in the picker. */
interface PageIcon {
  Glyph: Glyph;
  /** The picker's accessible name for it. */
  label: string;
}

/** Every `Icon` the API knows, in the order the picker shows them. */
export const PAGE_ICONS = {
  GLOBE: { Glyph: Globe, label: 'Globe' },
  HOUSE: { Glyph: House, label: 'House' },
  SERVER: { Glyph: Server, label: 'Server' },
  ROUTER: { Glyph: Router, label: 'Router' },
  CLOUD: { Glyph: Cloud, label: 'Cloud' },
  DATABASE: { Glyph: Database, label: 'Database' },
  SHIELD: { Glyph: Shield, label: 'Shield' },
  TERMINAL: { Glyph: Terminal, label: 'Terminal' },
  CODE: { Glyph: Code, label: 'Code' },
  CHART: { Glyph: ChartLine, label: 'Chart' },
  KANBAN: { Glyph: SquareKanban, label: 'Kanban board' },
  CALENDAR: { Glyph: Calendar, label: 'Calendar' },
  MAIL: { Glyph: Mail, label: 'Mail' },
  FILM: { Glyph: Film, label: 'Film' },
  MUSIC: { Glyph: Music, label: 'Music' },
  IMAGE: { Glyph: Image, label: 'Image' },
  CAMERA: { Glyph: Camera, label: 'Camera' },
  BOOK: { Glyph: BookOpen, label: 'Book' },
  DOWNLOAD: { Glyph: Download, label: 'Download' },
  GAMEPAD: { Glyph: Gamepad2, label: 'Game controller' },
  PRINTER: { Glyph: Printer, label: 'Printer' },
  SETTINGS: { Glyph: Settings, label: 'Settings' },
} satisfies Record<Icon, PageIcon>;

/** The `Icon` values in picker order. */
export const ICON_CHOICES = Object.keys(PAGE_ICONS) as Icon[];

/**
 * Draws a page's or item's icon.
 *
 * @param icon - The stored icon, or null for none.
 * @param fallback - What to draw when there is none.
 * @returns The glyph's element.
 */
export function iconElement(icon: Icon | null, fallback: Glyph): ReactElement {
  const Glyph = icon === null ? fallback : PAGE_ICONS[icon].Glyph;
  return <Glyph />;
}

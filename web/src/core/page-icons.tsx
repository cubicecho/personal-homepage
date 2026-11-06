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
import { type ReactElement, type ReactNode, useState } from 'react';
import { Calendar, Download, type IconProps, Settings } from '@/components/ui/icons';

/** A glyph component, as lucide and `@cubeui/icons` both export them. */
export type Glyph = (props: IconProps) => ReactNode;

/** How one built-in glyph is drawn, and what it is called in the picker. */
interface PageIcon {
  Glyph: Glyph;
  /** The picker's accessible name for it. */
  label: string;
}

/** Every built-in glyph name the API knows (`BUILT_IN_ICONS` on the server), in the order the picker shows them. */
export const PAGE_ICONS = {
  globe: { Glyph: Globe, label: 'Globe' },
  house: { Glyph: House, label: 'House' },
  server: { Glyph: Server, label: 'Server' },
  router: { Glyph: Router, label: 'Router' },
  cloud: { Glyph: Cloud, label: 'Cloud' },
  database: { Glyph: Database, label: 'Database' },
  shield: { Glyph: Shield, label: 'Shield' },
  terminal: { Glyph: Terminal, label: 'Terminal' },
  code: { Glyph: Code, label: 'Code' },
  chart: { Glyph: ChartLine, label: 'Chart' },
  kanban: { Glyph: SquareKanban, label: 'Kanban board' },
  calendar: { Glyph: Calendar, label: 'Calendar' },
  mail: { Glyph: Mail, label: 'Mail' },
  film: { Glyph: Film, label: 'Film' },
  music: { Glyph: Music, label: 'Music' },
  image: { Glyph: Image, label: 'Image' },
  camera: { Glyph: Camera, label: 'Camera' },
  book: { Glyph: BookOpen, label: 'Book' },
  download: { Glyph: Download, label: 'Download' },
  gamepad: { Glyph: Gamepad2, label: 'Game controller' },
  printer: { Glyph: Printer, label: 'Printer' },
  settings: { Glyph: Settings, label: 'Settings' },
} satisfies Record<string, PageIcon>;

/** A built-in glyph's name. */
export type GlyphName = keyof typeof PAGE_ICONS;

/** The glyph names in picker order. */
export const ICON_CHOICES = Object.keys(PAGE_ICONS) as GlyphName[];

/**
 * Checks whether an icon reference names a built-in glyph.
 *
 * @param icon - An icon reference.
 * @returns True for a glyph name.
 */
export function isGlyphName(icon: string): icon is GlyphName {
  return Object.hasOwn(PAGE_ICONS, icon);
}

interface IconImageProps {
  src: string;
  /** Drawn instead when the image doesn't load: a site that is down, or an icon that was removed. */
  fallback: Glyph;
}

/** An icon image, falling back to a glyph when it can't be loaded. */
function IconImage({ src, fallback: Fallback }: IconImageProps) {
  const [isBroken, setIsBroken] = useState(false);
  if (isBroken) {
    return <Fallback />;
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="size-full object-contain"
      onError={() => setIsBroken(true)}
    />
  );
}

/**
 * Draws a page's or item's icon.
 *
 * @param icon - The stored icon reference, or null for none.
 * @param fallback - What to draw when there is none, it is not a glyph and has no image, or the image fails.
 * @param [iconUrl] - Where the server says the icon's image is; drawn instead of a glyph when set.
 * @returns The icon's element.
 */
export function iconElement(icon: string | null, fallback: Glyph, iconUrl: string | null = null): ReactElement {
  if (iconUrl !== null) {
    // Keyed by the address, so a new address gets a fresh try after an old one failed.
    return <IconImage key={iconUrl} src={iconUrl} fallback={fallback} />;
  }
  const Glyph = icon !== null && isGlyphName(icon) ? PAGE_ICONS[icon].Glyph : fallback;
  return <Glyph />;
}

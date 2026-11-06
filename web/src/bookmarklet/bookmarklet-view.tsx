import { useEffect, useRef } from 'react';
import { useSsoSetup } from '@/auth/use-access';
import { CardLayout } from '@/components/card-layout';
import { Alert } from '@/components/ui/alert';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { useToast } from '@/components/ui/toast';
import { Bookmark } from '@/core/app-icons';
import { bookmarkletCode, bookmarkletOrigin, isLocalOrigin } from './add-link';

/** Where the address the bookmarklet opens came from, in words. */
const ORIGIN_SOURCES = {
  configured: 'set by APP_URL',
  paired: 'recorded when sign-in was set up',
  browser: 'the address this browser has the homepage open at',
} as const;

/** This page: what the link points at until its script is set. */
const BOOKMARKLET_SETTINGS_PATH = '/settings/bookmarklet';

const BUTTON_CLASS =
  'inline-flex h-10 cursor-grab items-center gap-2 self-start rounded-md bg-info px-4 font-medium text-info-foreground text-sm hover:bg-info/90 focus-visible:bg-hover focus-visible:text-foreground active:cursor-grabbing';

/**
 * The bookmarklet itself: a link whose address is the script, made to be dragged to the bookmarks bar.
 *
 * @param props - The script.
 * @param props.code - The `javascript:` address.
 * @returns The link.
 *
 * @remarks
 * React refuses to render a `javascript:` href, so the address is set on the element after it mounts.
 * Clicked here, it does nothing but say what it is for: the page it adds is the one it is clicked on.
 */
function BookmarkletLink({ code }: { code: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  const toast = useToast();
  useEffect(() => {
    link.current?.setAttribute('href', code);
  }, [code]);
  return (
    <a
      ref={link}
      // A real address until the effect puts the script in its place, which React would not render.
      href={BOOKMARKLET_SETTINGS_PATH}
      className={BUTTON_CLASS}
      draggable
      title="Drag me to your bookmarks bar"
      onClick={(event) => {
        event.preventDefault();
        toast('Drag this button to your bookmarks bar, then click it on the site you want to add.', 'info');
      }}
    >
      <Bookmark className="size-4" aria-hidden />
      Add to homepage
    </a>
  );
}

/**
 * Settings' Bookmarklet section: what it is, the button to drag, and the code to paste by hand.
 *
 * @returns The section.
 */
export function BookmarkletView() {
  const setup = useSsoSetup().data;
  const { origin, source } = bookmarkletOrigin(setup, window.location.origin);
  const code = bookmarkletCode(origin);

  return (
    <div className="flex flex-col gap-6">
      <CardLayout
        title="Add to homepage from any site"
        description="A bookmarklet is a bookmark that runs a little script instead of opening a page. Click this one on any site and the homepage opens with that site's address and name filled in, ready to add."
        contentSlot={
          <div className="flex flex-col gap-4">
            <BookmarkletLink code={code} />
            <ol className="list-decimal space-y-1 pl-5 text-foreground/80 text-sm">
              <li>Drag the button above to your browser's bookmarks bar.</li>
              <li>On a site you want on the homepage, click the bookmark.</li>
              <li>Choose a page, check the details, and add it.</li>
            </ol>
            <p className="text-foreground/60 text-sm">
              It opens {origin} ({ORIGIN_SOURCES[source]}).
            </p>
            {isLocalOrigin(origin) ? (
              <Alert
                variant="warning"
                title="This address only works on this computer"
                description="The bookmarklet opens localhost, which is a different machine on every device. Set APP_URL to the address you open the homepage at, or open Settings from that address, before copying it to another device."
              />
            ) : null}
          </div>
        }
      />
      <CardLayout
        title="Can't drag it?"
        description="On a phone, or where dragging is awkward: copy the code, make a new bookmark of any page, then edit the bookmark and paste the code as its address."
        contentSlot={
          <div className="flex flex-col gap-3">
            <CodeBlock
              title="Bookmarklet"
              content={code}
              wrap
              actionSlot={<CopyButton value={code} label="Copy the bookmarklet" />}
            />
            <p className="text-foreground/60 text-sm">
              A few sites with strict security settings stop bookmarklets from running. On those, use Add item on a page
              and paste the address instead.
            </p>
          </div>
        }
      />
    </div>
  );
}

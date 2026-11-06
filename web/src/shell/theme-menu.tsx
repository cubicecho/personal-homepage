import { Button } from '@/components/ui/button';
import { Monitor, Moon, Sun } from '@/components/ui/icons';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu';
import { useThemePreference } from '@/components/ui/theme-preference';
import { isThemePreference, type ThemePreference } from '@/components/ui/theme-preference-base';

/** Each theme choice: what it is called and the glyph that shows it. */
const THEMES = {
  light: { label: 'Light', Glyph: Sun },
  dark: { label: 'Dark', Glyph: Moon },
  system: { label: 'System', Glyph: Monitor },
} as const satisfies Record<ThemePreference, { label: string; Glyph: unknown }>;

/**
 * The theme choice as one icon button with a menu: what the folded sidebar has room for.
 *
 * @remarks
 * The button shows the current choice's glyph and says it in its name ("Theme: System"); the menu
 * offers all three, the current one checked. It reads and stores the same preference as `ThemePicker`.
 */
export function ThemeMenu() {
  const [theme, setTheme] = useThemePreference();
  const current = THEMES[theme];
  const name = `Theme: ${current.label}`;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={name} hint={name} iconSlot={<current.Glyph />} />
      </MenuTrigger>
      <MenuContent side="right" align="end">
        <MenuRadioGroup
          value={theme}
          onValueChange={(next) => {
            if (isThemePreference(next)) {
              setTheme(next);
            }
          }}
        >
          {Object.entries(THEMES).map(([value, { label, Glyph }]) => (
            <MenuRadioItem key={value} value={value} label={label} iconSlot={<Glyph />} />
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

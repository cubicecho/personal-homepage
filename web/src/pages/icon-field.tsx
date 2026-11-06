import { bindToForm, type FieldProps, useFieldContext, useFieldError } from '@/components/app-form';
import { FormField } from '@/components/form-field';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { Ban } from '@/core/app-icons';
import { ICON_CHOICES, PAGE_ICONS } from '@/core/page-icons';

const NO_ICON_LABEL = 'No icon';

/** Picks one of the page icons, or none, from a grid of glyphs. */
function BoundIconField(props: FieldProps) {
  const field = useFieldContext<string | null>();
  const value = field.state.value;

  /**
   * Stores a choice and marks the field touched, as a blur would.
   *
   * @param next - The icon chosen, or null for none.
   */
  const choose = (next: string | null): void => {
    field.handleChange(next);
    field.handleBlur();
  };

  return (
    <FormField
      {...props}
      asGroup
      error={useFieldError()}
      controlSlot={(wired) => (
        <fieldset {...wired} className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
          <ToggleChip
            size="sm"
            aria-label={NO_ICON_LABEL}
            title={NO_ICON_LABEL}
            selected={value === null}
            onClick={() => choose(null)}
          >
            <Ban className="size-4" aria-hidden />
          </ToggleChip>
          {ICON_CHOICES.map((icon) => {
            const { Glyph, label } = PAGE_ICONS[icon];
            return (
              <ToggleChip
                key={icon}
                size="sm"
                aria-label={label}
                title={label}
                selected={value === icon}
                onClick={() => choose(icon)}
              >
                <Glyph className="size-4" aria-hidden />
              </ToggleChip>
            );
          })}
        </fieldset>
      )}
    />
  );
}

/** The icon picker, bound to a form field holding an icon reference or null. */
export const IconField = bindToForm<FieldProps, string | null>(BoundIconField, 'IconField');

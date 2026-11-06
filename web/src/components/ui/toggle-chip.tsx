import * as React from "react";
import { cn } from "@/lib/utils";

export type ToggleChipProps = Omit<
  React.ComponentPropsWithoutRef<"button">,
  "children" | "className" | "style"
> & {
  selected?: boolean | undefined;
  /**
   * Overrides the selected background with a literal colour — for a chip whose
   * own colour is the content, such as a palette swatch. Passing it also turns
   * off the selected label colour, since the caller's background is unknown and
   * `text-active-foreground` would be a guess. Pair it with
   * `readableTextColor` if the label has to stay legible on an arbitrary hue.
   */
  backgroundColor?: string | undefined;
  size?: "sm" | "default" | undefined;
  // Re-declared rather than inherited, for the reason `button.tsx` gives:
  // nativewind types it as `className?: string`, which under
  // `exactOptionalPropertyTypes` rejects the `cond ? "x" : undefined` that call
  // sites pass.
  className?: string | undefined;
  children: React.ReactNode;
};

/** A small pill that is selected or not: a filter chip, a day-of-week toggle. */
const ToggleChip = React.forwardRef<HTMLButtonElement, ToggleChipProps>(
  (
    {
      selected = false,
      disabled = false,
      backgroundColor,
      size = "default",
      className,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      type="button"
      ref={ref as React.Ref<HTMLButtonElement>}
      disabled={disabled}
      // The same two facts in the spelling the web understands. react-native-web does not read
      // `accessibilityState` — it forwards an allowlist of `aria-*` props and nothing else — so
      // without these the chip is styled but silent to a screen reader. `aria-pressed` and not
      // `aria-selected` because this is a `button`, where `aria-selected` is markup axe rejects.
      aria-pressed={selected}
      aria-disabled={disabled ?? false}
      className={cn(
        "cube-rn-view cube-rn-pressable",
        "group/chip items-center justify-center rounded-md border focus-visible:outline-none",
        // The button's `xs` and `sm` heights, so a chip sits flush beside a button or a
        // segmented control rather than 2px off it.
        size === "sm" ? "h-7 px-2" : "h-9 px-3",
        // A control's edge is /50, 3:1 on every surface: at /10 an unchosen chip was a faint box
        // beside the segmented frame. Focus looks hovered; a chosen chip, which has no hover,
        // deepens instead.
        selected
          ? "border-active bg-active focus-visible:bg-hover focus-visible:text-foreground active:bg-active/90"
          : "border-foreground/50 bg-background hover:bg-hover focus-visible:bg-hover active:bg-hover",
        // The label colour on the container as well as on the `<Text>` below,
        // and that is not a duplicate. The `<Text>` is the only one native
        // reads, and it is only ever reached by a bare string; an element
        // child — an icon, a `<Badge>`, anything with its own markup — passes
        // through untouched and on web takes its colour by inheriting from
        // here. Without this line a selected chip holding markup drew
        // `text-foreground` on `bg-neutral`, which is near-black on near-black.
        // Its own `focus-visible:`, not the `group-*/chip` variant the label takes: that variant
        // selects what is inside the chip, so on the chip itself it would never apply.
        selected && !backgroundColor
          ? "text-active-foreground focus-visible:text-foreground"
          : "text-foreground",
        disabled && "opacity-50",
        className,
      )}
      {...(backgroundColor ? { style: { backgroundColor } } : {})}
      {...(props as React.ComponentPropsWithoutRef<"button">)}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <span
          className={cn(
            "cube-rn-text",
            "font-semibold",
            size === "sm" ? "text-xs" : "text-sm",
            selected && !backgroundColor
              ? "text-active-foreground group-focus-visible/chip:text-foreground"
              : "text-foreground",
          )}
        >
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  ),
);
ToggleChip.displayName = "ToggleChip";

export { ToggleChip };

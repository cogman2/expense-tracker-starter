import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pageItems } from "@/lib/pageItems";
import { cn } from "@/lib/utils";

// A generic pager: « First  ‹ Previous  1 … 4 [5] 6 … 20  Next ›  Last », plus
// a "Go to page" field once some pages hide behind an ellipsis. It only
// reports the page asked for (onPageChange); the caller owns the URL and data.
//
// Controls that can't be used right now — First on page 1, or anything while
// a page loads — are marked aria-disabled and ignore activation, but are NOT
// natively disabled. Browsers move focus off a disabled element, so a keyboard
// user who pressed Next would land on <body> once the button disabled itself
// for the load; with aria-disabled their focus stays on the pager.

/** Above this many pages some are hidden, so jumping straight to one helps. */
const JUMP_THRESHOLD = 7;

interface PagerProps {
  /** The page on screen, 1-based. */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Disables every control, e.g. while the next page loads. */
  disabled?: boolean;
  /** The navigation landmark's accessible name, e.g. "Ticket pages". */
  label: string;
}

export function Pager({ page, totalPages, onPageChange, disabled = false, label }: PagerProps) {
  if (totalPages <= 1) return null;

  const atFirst = page <= 1;
  const atLast = page >= totalPages;
  const go = (target: number) => {
    if (target !== page) onPageChange(target);
  };

  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <PagerButton unavailable={disabled || atFirst} onActivate={() => go(1)}>
          <ChevronsLeft aria-hidden="true" />
          First
        </PagerButton>
        <PagerButton unavailable={disabled || atFirst} onActivate={() => go(page - 1)}>
          <ChevronLeft aria-hidden="true" />
          Previous
        </PagerButton>

        {pageItems(page, totalPages).map((item, index) =>
          item === "ellipsis" ? (
            // Keyed by position: there can be two, and they carry no page.
            <span key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-gray-400">
              …
            </span>
          ) : (
            <PagerButton
              key={item}
              variant={item === page ? "default" : "ghost"}
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
              unavailable={disabled}
              onActivate={() => go(item)}
              className="min-w-7 tabular-nums"
            >
              {item}
            </PagerButton>
          ),
        )}

        <PagerButton unavailable={disabled || atLast} onActivate={() => go(page + 1)}>
          Next
          <ChevronRight aria-hidden="true" />
        </PagerButton>
        <PagerButton unavailable={disabled || atLast} onActivate={() => go(totalPages)}>
          Last
          <ChevronsRight aria-hidden="true" />
        </PagerButton>
      </div>

      {totalPages > JUMP_THRESHOLD && (
        <JumpToPage page={page} totalPages={totalPages} disabled={disabled} onJump={go} />
      )}
    </nav>
  );
}

/**
 * A pager button that stays focusable when it can't be used: aria-disabled
 * (announced as dimmed/unavailable) and a no-op on click or Enter, with the
 * same look as a disabled Button. See the note at the top of this file.
 */
function PagerButton({
  unavailable,
  onActivate,
  variant = "outline",
  className,
  children,
  ...aria
}: {
  unavailable: boolean;
  onActivate: () => void;
  variant?: "default" | "outline" | "ghost";
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page";
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      aria-disabled={unavailable || undefined}
      onClick={() => {
        if (!unavailable) onActivate();
      }}
      className={cn(unavailable && "cursor-not-allowed opacity-50", className)}
      {...aria}
    >
      {children}
    </Button>
  );
}

/**
 * "Go to page [ ] Go": a whole number from 1 to totalPages. Anything else is
 * refused — the field is marked invalid and nothing navigates — rather than
 * clamped, so a typo doesn't silently land somewhere unexpected.
 */
function JumpToPage({
  page,
  totalPages,
  disabled,
  onJump,
}: {
  page: number;
  totalPages: number;
  disabled: boolean;
  onJump: (page: number) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  // A new page (by the buttons, Back, or a jump) makes whatever is typed and
  // any error stale, so both clear. Done while rendering rather than by
  // remounting (key={page}), which would recreate the input and drop focus.
  const [shownFor, setShownFor] = useState(page);
  if (page !== shownFor) {
    setShownFor(page);
    setValue("");
    setInvalid(false);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // While a page loads the field is read-only rather than disabled (so focus
    // stays in it) and the form ignores submits.
    if (disabled) return;
    const text = value.trim();
    const target = Number(text);
    // Digits only: Number() alone would also accept "1e1", "0x2" or " ".
    if (!/^\d+$/.test(text) || target < 1 || target > totalPages) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setValue("");
    onJump(target);
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2 text-sm">
      <label htmlFor={inputId} className="text-gray-500">
        Go to page
      </label>
      <Input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        readOnly={disabled}
        aria-disabled={disabled || undefined}
        className={cn("h-7 w-16", disabled && "opacity-50")}
      />
      <span id={hintId} className={invalid ? "text-red-600" : "text-gray-400"}>
        1–{totalPages}
      </span>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        aria-disabled={disabled || undefined}
        className={cn(disabled && "cursor-not-allowed opacity-50")}
      >
        Go
      </Button>
    </form>
  );
}

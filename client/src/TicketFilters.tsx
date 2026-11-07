import { useId } from "react";
import {
  TICKET_FILTER_KEYS,
  TICKET_FILTERS,
  type TicketFilterKey,
  type TicketFilterValue,
  type TicketFilterValues,
} from "core";
import { Button } from "@/components/ui/button";

// The ticket list's filter controls, generated from core's TICKET_FILTERS
// (core/src/filters/tickets.ts): one labelled button group per entry — "All"
// plus a choice per value, shown by its display label. Nothing here names a
// filter, so a new registry entry gets its control without touching this file.

export type TicketFilterChange = <K extends TicketFilterKey>(
  key: K,
  value: TicketFilterValue<K> | undefined,
) => void;

interface TicketFiltersProps {
  /** The active filters; a missing key means "All". */
  values: TicketFilterValues;
  /** Called with the key and its new value, or undefined for "All". */
  onChange: TicketFilterChange;
}

export function TicketFilters({ values, onChange }: TicketFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {TICKET_FILTER_KEYS.map((key) => (
        <FilterGroup
          key={key}
          filterKey={key}
          value={values[key]}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function FilterGroup<K extends TicketFilterKey>({
  filterKey,
  value,
  onChange,
}: {
  filterKey: K;
  value: TicketFilterValue<K> | undefined;
  onChange: TicketFilterChange;
}) {
  const labelId = useId();
  const { label, values, optionLabels } = TICKET_FILTERS[filterKey];
  // `id` keys each button by value, not label: labels needn't be unique (an
  // option could even be labelled "All"). "All" has no value, so it gets the
  // empty id — never a real option's value, since an empty query param can't
  // select one.
  const choices: { id: string; value: TicketFilterValue<K> | undefined; label: string }[] = [
    { id: "", value: undefined, label: "All" },
    ...values.map((option) => ({ id: option, value: option, label: optionLabels[option] })),
  ];

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="text-sm font-medium text-gray-500">
        {label}
      </span>
      {choices.map((choice) => {
        const pressed = choice.value === value;
        return (
          <Button
            key={choice.id}
            type="button"
            size="sm"
            variant={pressed ? "default" : "outline"}
            aria-pressed={pressed}
            onClick={() => {
              if (!pressed) onChange(filterKey, choice.value);
            }}
          >
            {choice.label}
          </Button>
        );
      })}
    </div>
  );
}

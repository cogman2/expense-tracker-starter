import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, TicketCategory } from "core";
import { TicketFilters } from "./TicketFilters";

// The control on its own: what it renders from core's registry and what it
// reports. How the page turns a report into a request is TicketsPage.test.tsx.

afterEach(cleanup);

const categoryGroup = () => screen.getByRole("group", { name: "Category" });
const choice = (name: string) => within(categoryGroup()).getByRole("button", { name });
const pressedChoices = () =>
  within(categoryGroup())
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);

describe("TicketFilters", () => {
  test("offers All plus every category by its display name, in registry order", () => {
    render(<TicketFilters values={{}} onChange={() => {}} />);

    const labels = within(categoryGroup())
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual([
      "All",
      ...TICKET_CATEGORIES.map((category) => TICKET_CATEGORY_LABELS[category]),
    ]);
    expect(labels).toEqual([
      "All",
      "General Question",
      "Technical Question",
      "Refund Request",
    ]);
  });

  test("presses All when no category is chosen", () => {
    render(<TicketFilters values={{}} onChange={() => {}} />);
    expect(pressedChoices()).toEqual(["All"]);
  });

  test("presses only the chosen category", () => {
    render(
      <TicketFilters
        values={{ category: TicketCategory.technical_question }}
        onChange={() => {}}
      />,
    );
    expect(pressedChoices()).toEqual(["Technical Question"]);
    expect(choice("All")).toHaveAttribute("aria-pressed", "false");
  });

  test("reports the category's stored value, not its label", async () => {
    const onChange = mock();
    const user = userEvent.setup();
    render(<TicketFilters values={{}} onChange={onChange} />);

    await user.click(choice("Refund Request"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("category", TicketCategory.refund_request);
  });

  test("reports All as no value", async () => {
    const onChange = mock();
    const user = userEvent.setup();
    render(
      <TicketFilters
        values={{ category: TicketCategory.general_question }}
        onChange={onChange}
      />,
    );

    await user.click(choice("All"));
    expect(onChange).toHaveBeenCalledWith("category", undefined);
  });

  test("clicking the choice already pressed reports nothing", async () => {
    const onChange = mock();
    const user = userEvent.setup();
    render(
      <TicketFilters
        values={{ category: TicketCategory.general_question }}
        onChange={onChange}
      />,
    );

    await user.click(choice("General Question"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ModeSelectorTrigger } from "../ModeSelectorTrigger";

describe("ModeSelectorTrigger", () => {
  it("uses neutral Agent and green Ask treatments for paid users", () => {
    const { rerender } = render(
      <DropdownMenu>
        <ModeSelectorTrigger chatMode="agent" isPaid />
      </DropdownMenu>,
    );

    expect(screen.getByTestId("mode-selector")).toHaveClass("bg-muted");
    expect(screen.getByTestId("mode-selector")).not.toHaveClass(
      "bg-destructive/10",
    );

    rerender(
      <DropdownMenu>
        <ModeSelectorTrigger chatMode="ask" isPaid />
      </DropdownMenu>,
    );

    expect(screen.getByTestId("mode-selector")).toHaveClass(
      "bg-success/10",
    );
  });

  it("preserves the existing colors for free users", () => {
    const { rerender } = render(
      <DropdownMenu>
        <ModeSelectorTrigger chatMode="agent" isPaid={false} />
      </DropdownMenu>,
    );

    expect(screen.getByTestId("mode-selector")).toHaveClass("bg-destructive/10");

    rerender(
      <DropdownMenu>
        <ModeSelectorTrigger chatMode="ask" isPaid={false} />
      </DropdownMenu>,
    );

    expect(screen.getByTestId("mode-selector")).toHaveClass("bg-muted");
    expect(screen.getByTestId("mode-selector")).not.toHaveClass(
      "bg-success/10",
    );
  });
});

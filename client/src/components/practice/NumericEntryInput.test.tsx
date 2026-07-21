// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumericEntryInput, isValidGridInFormat } from "./NumericEntryInput";

vi.mock("@/components/MathRenderer", () => ({
  default: ({ content }: { content: string }) => (
    <span data-testid="math">{content}</span>
  ),
}));

describe("NumericEntryInput", () => {
  it("renders an input with accessible label", () => {
    render(<NumericEntryInput value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Enter your answer")).not.toBeNull();
  });

  it("has inputMode=decimal for mobile numeric keypad", () => {
    render(<NumericEntryInput value="" onChange={() => {}} />);
    expect(
      screen.getByLabelText("Enter your answer").getAttribute("inputmode"),
    ).toBe("decimal");
  });

  it("accepts valid numeric values", () => {
    const onChange = vi.fn();
    render(<NumericEntryInput value="" onChange={onChange} />);
    const input = screen.getByLabelText("Enter your answer");

    for (const val of ["42", "0.2", "1/5", "-4", "7/2", "3.14"]) {
      fireEvent.change(input, { target: { value: val } });
      expect(onChange).toHaveBeenCalledWith(val);
    }
  });

  it("filters alphabetic characters", () => {
    const onChange = vi.fn();
    render(<NumericEntryInput value="" onChange={onChange} />);
    const input = screen.getByLabelText("Enter your answer");

    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows format hint for malformed input", () => {
    render(<NumericEntryInput value="1.2.3" onChange={() => {}} />);
    expect(
      screen.getByText(/Enter a number, decimal, or fraction/),
    ).not.toBeNull();
  });

  it("does not show format hint for valid input", () => {
    render(<NumericEntryInput value="1/5" onChange={() => {}} />);
    expect(
      screen.queryByText(/Enter a number, decimal, or fraction/),
    ).toBeNull();
  });

  it("does not show format hint when empty", () => {
    render(<NumericEntryInput value="" onChange={() => {}} />);
    expect(
      screen.queryByText(/Enter a number, decimal, or fraction/),
    ).toBeNull();
  });

  it("disables input when disabled=true", () => {
    render(<NumericEntryInput value="" onChange={() => {}} disabled />);
    expect(
      (screen.getByLabelText("Enter your answer") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("disables input when showResult=true", () => {
    render(
      <NumericEntryInput value="42" onChange={() => {}} showResult isCorrect />,
    );
    expect(
      (screen.getByLabelText("Enter your answer") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("shows correct feedback", () => {
    render(
      <NumericEntryInput
        value="0.2"
        onChange={() => {}}
        showResult
        isCorrect
        correctAnswer="0.2"
      />,
    );
    expect(screen.getByText("Correct")).not.toBeNull();
    expect(screen.getByText("Your answer:")).not.toBeNull();
  });

  it("shows incorrect feedback with correct answer", () => {
    render(
      <NumericEntryInput
        value="0.3"
        onChange={() => {}}
        showResult
        isCorrect={false}
        correctAnswer="0.2"
      />,
    );
    expect(screen.getByText("Incorrect")).not.toBeNull();
    expect(screen.getByText("Correct answer:")).not.toBeNull();
    // MathRenderer mock renders the content as text
    const mathNodes = screen.getAllByTestId("math");
    const correctNode = mathNodes.find((n) => n.textContent === "0.2");
    expect(correctNode).not.toBeUndefined();
  });

  it("shows explanation when provided", () => {
    render(
      <NumericEntryInput
        value="0.3"
        onChange={() => {}}
        showResult
        isCorrect={false}
        correctAnswer="0.2"
        explanation="Convert 1/5 to decimal."
      />,
    );
    expect(screen.getByText("Explanation")).not.toBeNull();
    expect(screen.getByText("Convert 1/5 to decimal.")).not.toBeNull();
  });

  it("does not show format hint after submit", () => {
    render(
      <NumericEntryInput
        value="1.2.3"
        onChange={() => {}}
        showResult
        isCorrect={false}
        correctAnswer="1.2"
      />,
    );
    expect(
      screen.queryByText(/Enter a number, decimal, or fraction/),
    ).toBeNull();
  });
});

describe("isValidGridInFormat", () => {
  it("accepts valid grid-in values", () => {
    for (const val of [
      "42",
      "0.2",
      "1/5",
      "-4",
      "7/2",
      "3.5",
      "0",
      ".5",
      "-.3",
    ]) {
      expect(isValidGridInFormat(val)).toBe(true);
    }
  });

  it("rejects malformed values", () => {
    for (const val of ["1/2/3", "1..2", "1.2.3", "/", ".", "-", "--4", "//5"]) {
      expect(isValidGridInFormat(val)).toBe(false);
    }
  });

  it("rejects empty string", () => {
    expect(isValidGridInFormat("")).toBe(false);
    expect(isValidGridInFormat("  ")).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { spinnerLine, startSpinner } from "./spinner";

afterEach(() => {
  vi.useRealTimers();
});

describe("spinnerLine", () => {
  it("shows a frame, the step and the elapsed seconds", () => {
    expect(spinnerLine(0, "Restauration", 12_900)).toBe("⠋ Restauration · 12 s");
    expect(spinnerLine(10, "x", 0)).toBe("⠋ x · 0 s");
  });
});

describe("startSpinner", () => {
  it("prints one line per step without a terminal", () => {
    const writes: string[] = [];
    const printed: string[] = [];
    const spinner = startSpinner("Étape 1", {
      stream: { isTTY: false, write: (c: string) => writes.push(c) },
      print: (m) => printed.push(m),
    });
    spinner.update("Étape 2");
    spinner.log("fini");
    spinner.stop();
    expect(writes).toEqual(["Étape 1…\n", "Étape 2…\n"]);
    expect(printed).toEqual(["fini"]);
  });

  it("redraws in place in a terminal, prints above the line and clears it on stop", () => {
    vi.useFakeTimers();
    let clock = 0;
    const writes: string[] = [];
    const printed: string[] = [];
    const spinner = startSpinner("Étape 1", {
      stream: { isTTY: true, write: (c: string) => writes.push(c) },
      print: (m) => printed.push(m),
      now: () => clock,
    });
    clock = 2_000;
    vi.advanceTimersByTime(80);
    spinner.update("Étape 2");
    spinner.log("note");
    spinner.stop();
    vi.advanceTimersByTime(500);

    expect(writes[0]).toBe("\r\x1b[2K⠋ Étape 1 · 0 s");
    expect(writes[1]).toBe("\r\x1b[2K⠙ Étape 1 · 2 s");
    expect(writes[2]).toBe("\r\x1b[2K⠹ Étape 2 · 2 s");
    expect(writes.at(-1)).toBe("\r\x1b[2K");
    expect(printed).toEqual(["note"]);
    expect(writes).toHaveLength(6);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyBias,
  biasByComponent,
  biasFactor,
  findReferenceTickets,
  isCloseAnalogue,
  nearestFibonacci,
  tshirtFromPoints,
  widenRange,
  type ReferenceTicketForEstimate,
} from "./reference";

const FIB = [1, 2, 3, 5, 8, 13, 21];
const BOUNDS = { S: 3, M: 8, L: 20 };

const ticket = (
  id: string,
  vector: number[],
  components: string[],
  estimated = 5,
  actual = 5,
): ReferenceTicketForEstimate => ({
  id,
  title: id,
  description: id,
  components,
  estimated_points: estimated,
  actual_points: actual,
  surprises: null,
  vector,
});

describe("findReferenceTickets", () => {
  const tickets = [
    ticket("T-103", [0, 1], ["taches"]),
    ticket("T-101", [1, 0], ["permissions"]),
    ticket("T-102", [1, 0], ["permissions"]),
    ticket("T-104", [0.6, 0.8], ["export"]),
  ];

  it("returns the k closest tickets with their similarity, ties broken by id", () => {
    const found = findReferenceTickets([1, 0], tickets, { k: 3, minSimilarity: 0.7 });
    expect(found.map((a) => a.ticket.id)).toEqual(["T-101", "T-102", "T-104"]);
    expect(found[0].similarity).toBeCloseTo(1);
    expect(found[2].similarity).toBeCloseTo(0.6);
  });

  it("flags close analogues against the threshold", () => {
    const found = findReferenceTickets([1, 0], tickets, { k: 3, minSimilarity: 0.7 });
    expect(found.map((a) => a.close)).toEqual([true, true, false]);
    expect(isCloseAnalogue(0.45, 0.45)).toBe(true);
    expect(isCloseAnalogue(0.449, 0.45)).toBe(false);
  });

  it("works on any ticket set, including an empty one (leave-one-out)", () => {
    expect(findReferenceTickets([1, 0], [], { minSimilarity: 0.5 })).toEqual([]);
    const withoutOne = tickets.filter((t) => t.id !== "T-101");
    expect(
      findReferenceTickets([1, 0], withoutOne, { k: 1, minSimilarity: 0.5 })[0].ticket.id,
    ).toBe("T-102");
  });
});

describe("biasFactor", () => {
  const tickets = [
    ticket("T-1", [1], ["permissions"], 5, 8),
    ticket("T-2", [1], ["permissions", "export"], 3, 5),
    ticket("T-3", [1], ["permissions"], 8, 13),
    ticket("T-4", [1], ["taches"], 5, 5),
  ];

  it("averages actual ÷ estimated over the distinct tickets touching the components", () => {
    const bias = biasFactor(["permissions", "export"], tickets, 3);
    expect(bias.applied).toBe(true);
    expect(bias.tickets).toBe(3); // T-2 counted once
    expect(bias.factor).toBeCloseTo((8 / 5 + 5 / 3 + 13 / 8) / 3);
  });

  it("does not correct below the minimal number of tickets", () => {
    expect(biasFactor(["export"], tickets, 3)).toEqual({ factor: 1, tickets: 1, applied: false });
    expect(biasFactor(["inconnu"], tickets, 3)).toEqual({ factor: 1, tickets: 0, applied: false });
  });

  it("gives one factor per component for the prompt", () => {
    const byComponent = biasByComponent(["permissions", "taches"], tickets, 3);
    expect(byComponent.permissions.applied).toBe(true);
    expect(byComponent.taches).toEqual({ factor: 1, tickets: 1, applied: false });
  });
});

describe("Fibonacci ranges", () => {
  it("rounds to the nearest Fibonacci value, ties going up", () => {
    expect(nearestFibonacci(4, FIB)).toBe(5);
    expect(nearestFibonacci(12, FIB)).toBe(13);
    expect(nearestFibonacci(40, FIB)).toBe(21);
    expect(nearestFibonacci(0.2, FIB)).toBe(1);
  });

  it("raises an underestimated range (permissions × 1.65)", () => {
    expect(applyBias({ min: 8, max: 13 }, 1.65, FIB)).toEqual({ min: 13, max: 21 });
    expect(applyBias({ min: 3, max: 5 }, 1, FIB)).toEqual({ min: 3, max: 5 });
    expect(applyBias({ min: 5, max: 8 }, 0.6, FIB)).toEqual({ min: 3, max: 5 });
  });

  it("widens a range on both sides, within the scale (CL-20)", () => {
    expect(widenRange({ min: 3, max: 5 }, 1.5, FIB)).toEqual({ min: 2, max: 8 });
    expect(widenRange({ min: 8, max: 13 }, 1.5, FIB)).toEqual({ min: 5, max: 21 });
    expect(widenRange({ min: 1, max: 2 }, 1.5, FIB)).toEqual({ min: 1, max: 3 });
    expect(widenRange({ min: 13, max: 21 }, 1.5, FIB)).toEqual({ min: 8, max: 21 });
  });

  it("derives T-shirt sizes from points (S < 3 ; M < 8 ; L < 20 ; XL)", () => {
    expect([1, 2, 3, 5, 8, 13, 20, 21].map((p) => tshirtFromPoints(p, BOUNDS))).toEqual([
      "S",
      "S",
      "M",
      "M",
      "L",
      "L",
      "XL",
      "XL",
    ]);
  });
});

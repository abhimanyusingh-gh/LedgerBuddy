import { computeBurndown } from "./burndown";

describe("computeBurndown", () => {
  it("returns empty array when no approvals", () => {
    expect(computeBurndown(100000, [])).toEqual([]);
  });

  it("returns empty array when total is zero", () => {
    expect(computeBurndown(0, [{ date: "2026-03-01", count: 1, amountMinor: 5000 }])).toEqual([]);
  });

  it("burns down total by daily approved amounts", () => {
    const result = computeBurndown(100000, [
      { date: "2026-03-01", count: 2, amountMinor: 30000 },
      { date: "2026-03-02", count: 3, amountMinor: 50000 }
    ]);
    expect(result).toEqual([
      { date: "2026-03-01", remainingMinor: 70000 },
      { date: "2026-03-02", remainingMinor: 20000 }
    ]);
  });

  it("floors at zero when approvals exceed total", () => {
    const result = computeBurndown(10000, [
      { date: "2026-03-01", count: 5, amountMinor: 50000 }
    ]);
    expect(result).toEqual([{ date: "2026-03-01", remainingMinor: 0 }]);
  });

  it("sorts dates chronologically", () => {
    const result = computeBurndown(100000, [
      { date: "2026-03-03", count: 1, amountMinor: 10000 },
      { date: "2026-03-01", count: 1, amountMinor: 20000 }
    ]);
    expect(result[0].date).toBe("2026-03-01");
    expect(result[1].date).toBe("2026-03-03");
  });

  it("reaches zero when fully approved", () => {
    const result = computeBurndown(80000, [
      { date: "2026-03-01", count: 2, amountMinor: 30000 },
      { date: "2026-03-02", count: 3, amountMinor: 50000 }
    ]);
    expect(result).toEqual([
      { date: "2026-03-01", remainingMinor: 50000 },
      { date: "2026-03-02", remainingMinor: 0 }
    ]);
  });

  it("handles missing amountMinor (treats as 0)", () => {
    const result = computeBurndown(50000, [
      { date: "2026-03-01", count: 1 },
      { date: "2026-03-02", count: 1, amountMinor: 20000 }
    ]);
    expect(result).toEqual([
      { date: "2026-03-01", remainingMinor: 50000 },
      { date: "2026-03-02", remainingMinor: 30000 }
    ]);
  });
});

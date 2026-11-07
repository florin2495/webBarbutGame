import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_GRACE_MS, kickRemainingMs } from "./kick";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

describe("kickRemainingMs", () => {
  it("is null when no kick is pending", () => {
    expect(kickRemainingMs(null, T0)).toBeNull();
    expect(kickRemainingMs(undefined, T0)).toBeNull();
    expect(kickRemainingMs("not a date", T0)).toBeNull();
  });
  it("counts down from the full grace", () => {
    expect(kickRemainingMs(iso(0), T0)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(iso(0), T0 + 3_500)).toBe(6_500);
  });
  it("clamps to [0, KICK_GRACE_MS]", () => {
    expect(kickRemainingMs(iso(0), T0 + 60_000)).toBe(0);
    expect(kickRemainingMs(iso(5_000), T0)).toBe(KICK_GRACE_MS); // clock skew: requested in the future
  });
});

describe("isKickExpired", () => {
  it("is false without a pending kick", () => {
    expect(isKickExpired(null, T0)).toBe(false);
  });
  it("allows 2 s of network grace after the 10 s", () => {
    expect(isKickExpired(iso(0), T0 + 10_000)).toBe(false);
    expect(isKickExpired(iso(0), T0 + 12_000)).toBe(false);
    expect(isKickExpired(iso(0), T0 + 12_001)).toBe(true);
  });
});

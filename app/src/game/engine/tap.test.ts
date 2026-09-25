import { describe, expect, it } from "vitest";
import { isTap, pickSlop, tapSlop } from "./tap";

describe("isTap", () => {
  it("takes a press that did not move as a tap", () => {
    expect(isTap({ x: 100, y: 100, multi: false }, 100, 100, "mouse")).toBe(true);
  });

  it("forgives a finger rolling a little, and a mouse less", () => {
    expect(isTap({ x: 100, y: 100, multi: false }, 110, 105, "touch")).toBe(true);
    expect(isTap({ x: 100, y: 100, multi: false }, 110, 105, "mouse")).toBe(false);
  });

  it("does not take the end of a pan as a tap", () => {
    expect(isTap({ x: 100, y: 100, multi: false }, 160, 130, "touch")).toBe(false);
  });

  it("does not take the last finger off a pinch as a tap", () => {
    expect(isTap({ x: 100, y: 100, multi: true }, 100, 100, "touch")).toBe(false);
  });

  it("does not take a release with no press as a tap", () => {
    expect(isTap(undefined, 100, 100, "mouse")).toBe(false);
  });
});

describe("slop", () => {
  it("is wider for a finger than for a cursor", () => {
    expect(tapSlop("touch")).toBeGreaterThan(tapSlop("mouse"));
    expect(pickSlop("touch")).toBeGreaterThan(pickSlop("mouse"));
  });
});

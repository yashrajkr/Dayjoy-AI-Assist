import { describe, expect, it } from "vitest";
import { deriveTitle, hasDefaultTitle } from "./chatStore";

describe("deriveTitle", () => {
  it("returns a normal-length question unchanged (normalized whitespace)", () => {
    expect(deriveTitle("How do I reset my password?")).toBe("How do I reset my password?");
  });

  it("passes through a short question / greeting untouched", () => {
    expect(deriveTitle("Hi")).toBe("Hi");
    expect(deriveTitle("Thanks!")).toBe("Thanks!");
  });

  it("truncates a very long question to maxLen with an ellipsis", () => {
    const long = "word ".repeat(50).trim();
    const title = deriveTitle(long);
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith("…")).toBe(true);
  });

  it("collapses internal whitespace/newlines before measuring length", () => {
    expect(deriveTitle("How do I   integrate\n\nVapi?")).toBe("How do I integrate Vapi?");
  });

  it("respects a custom maxLen", () => {
    expect(deriveTitle("Distributor commission tracking system", 10)).toBe("Distribut…");
  });
});

describe("hasDefaultTitle", () => {
  it("is true for the default placeholder", () => {
    expect(hasDefaultTitle("New conversation")).toBe(true);
  });

  it("is true for null/undefined/empty titles", () => {
    expect(hasDefaultTitle(null)).toBe(true);
    expect(hasDefaultTitle(undefined)).toBe(true);
    expect(hasDefaultTitle("")).toBe(true);
  });

  it("is false once a title has been auto-generated or manually renamed", () => {
    expect(hasDefaultTitle("Vapi Backend Integration")).toBe(false);
    expect(hasDefaultTitle("My custom renamed title")).toBe(false);
  });
});

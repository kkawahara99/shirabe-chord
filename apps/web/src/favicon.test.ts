import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";

const publicFiles = import.meta.glob("../public/*", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const iconTag = indexHtml.match(/<link\s[^>]*rel="icon"[^>]*>/)?.[0];
const href = iconTag?.match(/href="([^"]+)"/)?.[1];
const iconFile = href === undefined ? undefined : publicFiles[`../public${href}`];

describe("favicon", () => {
  it("index.html が SVG の icon を指定している", () => {
    expect(iconTag).toContain('type="image/svg+xml"');
    expect(href).toBe("/favicon.svg");
  });

  it("icon の href が指すファイルが public/ に実在する", () => {
    expect(iconFile).toBeDefined();
  });

  it("そのファイルは青 #2563eb で塗った SVG である", () => {
    expect(iconFile).toContain("<svg");
    expect(iconFile).toContain('fill="#2563eb"');
  });
});

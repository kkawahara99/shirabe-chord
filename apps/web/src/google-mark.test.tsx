import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoogleMark } from "./google-mark.tsx";

const draw = () => render(<GoogleMark />).container.querySelector("svg")!;
/** Google のログインボタンの規定にある「G」の 4 色。 */
const OFFICIAL_COLORS = ["#EA4335", "#4285F4", "#FBBC05", "#34A853"];

describe("GoogleMark", () => {
  it("読み上げには出さない（aria-hidden=\"true\"・focusable=\"false\"）。title と aria-label は付けない", () => {
    const svg = draw();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("title")).toBeNull();
    expect(svg.hasAttribute("aria-label")).toBe(false);
  });

  it("style・image・use・script などの要素や、外部参照・url( を持たない", () => {
    const svg = draw();
    expect(svg.querySelector("style, image, use, script, foreignObject")).toBeNull();
    expect(svg.outerHTML).not.toMatch(/href|url\(/i);
    expect(svg.hasAttribute("style")).toBe(false);
  });

  it("図形は公式の 4 色のパスで、色は変えていない", () => {
    const fills = [...draw().querySelectorAll("path")].map((path) => path.getAttribute("fill"));
    expect(fills).toEqual(OFFICIAL_COLORS);
  });

  it("白い丸の背景は `.icon` ではなく `.google-mark` で描く", () => {
    const svg = draw();
    expect(svg.classList.contains("google-mark")).toBe(true);
    expect(svg.classList.contains("icon")).toBe(false);
  });
});

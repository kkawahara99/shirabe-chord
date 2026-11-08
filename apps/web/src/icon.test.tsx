import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICONS, Icon, type IconName } from "./icon.tsx";

const NAMES = Object.keys(ICONS) as IconName[];
const draw = (name: IconName) => render(<Icon name={name} />).container.querySelector("svg")!;

describe("Icon", () => {
  it("どのアイコンも aria-hidden=\"true\" の svg を描く", () => {
    for (const name of NAMES) expect(draw(name).getAttribute("aria-hidden")).toBe("true");
  });

  it("どのアイコンも色を currentColor で指定し、固定の色を持たない", () => {
    for (const name of NAMES) {
      const svg = draw(name);
      for (const element of [svg, ...svg.querySelectorAll("*")]) {
        for (const attribute of ["stroke", "fill"]) {
          const value = element.getAttribute(attribute);
          if (value !== null) expect(["currentColor", "none"]).toContain(value);
        }
      }
    }
  });

  it("SVG の中に style 要素・外部参照を置かない", () => {
    for (const name of NAMES) {
      const svg = draw(name);
      expect(svg.querySelector("style, image, use, script, foreignObject")).toBeNull();
      expect(svg.outerHTML).not.toMatch(/href|url\(/i);
    }
  });

  it("対応表のどの名前も、空でない図を描ける", () => {
    for (const name of NAMES) expect(draw(name).querySelectorAll("path, rect, circle, line").length).toBeGreaterThan(0);
  });

  it("ごみ箱と閉じる（×）は別の図", () => {
    expect(draw("trash").innerHTML).not.toBe(draw("close").innerHTML);
  });
});

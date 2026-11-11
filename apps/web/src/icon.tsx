import type { ReactNode } from "react";

/**
 * 操作ボタンに添える図。外部のアイコンフォントや CDN は CSP（default-src 'self'）で使えないので、手書きの SVG を持つ。
 * 色は currentColor（文字色に従う）。名前の型はこの対応表から作るので、図を足し忘れると型で分かる。
 */
export const ICONS = {
  print: (
    <>
      <path d="M7 9V4h10v5" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <rect x="7" y="14" width="10" height="6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M8 5v14l11-7z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  add: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" />
    </>
  ),
  open: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z" />
      <path d="M14 7l3 3" />
    </>
  ),
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

/** 読み上げには出さない（ボタンの名前は文字か aria-label が担う）。 */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

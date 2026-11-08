import type { MouseEvent } from "react";

/** `/mine` の最小の画面。中身は共有の一覧の Issue で作る。共有ページは `share-page.tsx`。 */
export function MinePage(props: { onHome: () => void }) {
  const goHome = (event: MouseEvent) => {
    event.preventDefault();
    props.onHome();
  };
  return (
    <main className="page">
      <h2>共有した譜面</h2>
      <a href="/" onClick={goHome}>
        トップへ戻る
      </a>
    </main>
  );
}

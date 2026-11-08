import type { MouseEvent } from "react";

/** `/mine` と `/s/<ID>` の最小の画面。中身は共有の一覧・共有ページの Issue で作る。 */
function Page(props: { title: string; onHome: () => void }) {
  const goHome = (event: MouseEvent) => {
    event.preventDefault();
    props.onHome();
  };
  return (
    <main className="page">
      <h2>{props.title}</h2>
      <a href="/" onClick={goHome}>
        トップへ戻る
      </a>
    </main>
  );
}

export const MinePage = (props: { onHome: () => void }) => <Page title="共有した譜面" onHome={props.onHome} />;
export const SharePage = (props: { onHome: () => void }) => <Page title="共有された譜面" onHome={props.onHome} />;

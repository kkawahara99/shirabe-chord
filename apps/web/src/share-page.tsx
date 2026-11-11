import { CAPO_FRETS, lowerSymbol, MAX_PROGRESSION_CHORDS, parseChord, type SharedChord, type SharedScore, type Voicing } from "@shirabe-chord/core";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { displaySymbol } from "./display-symbol.ts";
import { importScore, type ImportedScore } from "./import-score.ts";
import { VoicingDiagram } from "./voicing-diagram.tsx";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "not-found" }
  | { readonly kind: "error" }
  | { readonly kind: "ok"; readonly score: SharedScore };

/** 図に描けるフレットの余裕のある上限。コアの生成は 15 までだが、閲覧では音楽的な妥当性を見ないので、形として明らかに壊れた値だけ弾く。 */
const MAX_DRAWN_FRET = 36;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 応答の形だけを確かめる。押さえ方の音楽的な妥当性（構成音・指の数など）は見ない。
 * 保存した押さえ方は、あとでコアの検証が厳しくなっても読めるようにしておく（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
 * 文字は React のテキストとしてしか出さないので、中身の検証は要らない。
 */
function readScore(value: unknown): SharedScore | null {
  if (!isRecord(value)) return null;
  const { title, note, displayName, capo, chords } = value;
  const validCapo = CAPO_FRETS.find((fret) => fret === capo);
  if (typeof title !== "string" || typeof note !== "string" || typeof displayName !== "string" || validCapo === undefined) return null;
  if (!Array.isArray(chords) || chords.length < 1 || chords.length > MAX_PROGRESSION_CHORDS) return null;
  const read: SharedChord[] = [];
  for (const chord of chords as unknown[]) {
    if (!isRecord(chord) || typeof chord.symbol !== "string" || !parseChord(lowerSymbol(chord.symbol, validCapo)).ok) return null;
    const { voicing } = chord;
    const isFret = (fret: unknown) => fret === null || (typeof fret === "number" && Number.isInteger(fret) && fret >= 0 && fret <= MAX_DRAWN_FRET);
    if (!Array.isArray(voicing) || voicing.length !== 6 || !voicing.every(isFret)) return null;
    read.push({ symbol: chord.symbol, voicing: voicing as Voicing });
  }
  return { title, note, displayName, capo: validCapo, chords: read };
}

async function load(id: string): Promise<State> {
  try {
    // 閲覧にログインは要らない。ログインのトークンは送らない
    const response = await fetch(`/api/shares/${id}`);
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "error" };
    const body: unknown = await response.json();
    // 応答は信用しない入力として、形を確かめてから使う
    const score = readScore(isRecord(body) ? body.score : undefined);
    return score ? { kind: "ok", score } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/**
 * 共有された譜面を、読み取り専用で出す。文字（タイトル・ひと言・表示名）は React の通常の描画だけで出す（HTML として解釈しない）。
 * 「この譜面を編集する」で、トップの編集画面に持ち込む。
 */
export function SharePage(props: { id: string; onHome: () => void; onEdit: (imported: ImportedScore) => void }) {
  const { id, onHome, onEdit } = props;
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void load(id).then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  const imported = useMemo(() => (state.kind === "ok" ? importScore(state.score) : null), [state]);

  const goHome = (event: MouseEvent) => {
    event.preventDefault();
    onHome();
  };

  return (
    <main className="page share-view">
      <h2>共有された譜面</h2>
      {state.kind === "loading" && <p role="status">読み込み中</p>}
      {state.kind === "not-found" && (
        <p role="alert">この譜面は見つかりません。削除されたか、URL が違うかもしれません。</p>
      )}
      {state.kind === "error" && <p role="alert">読み込めませんでした。時間をおいて、もう一度お試しください。</p>}
      {state.kind === "ok" && (
        <>
          <h3 className="share-title">{state.score.title}</h3>
          {state.score.note !== "" && <p className="share-note">{state.score.note}</p>}
          <p className="share-by">共有した人：{state.score.displayName}</p>
          {state.score.capo > 0 && <p className="capo-note">カポ{state.score.capo}</p>}
          <ul className="steps" aria-label="コード進行">
            {state.score.chords.map(({ symbol, voicing }, i) => {
              const shape = lowerSymbol(symbol, state.score.capo);
              return (
                <li key={i} className="step">
                  <span className="step-number">{i + 1}</span>
                  <span className="step-name">{displaySymbol(symbol)}</span>
                  <VoicingDiagram symbol={shape} voicing={voicing} hideCaption showFingers />
                  {state.score.capo > 0 && <p className="step-shape">{displaySymbol(shape)}の形</p>}
                </li>
              );
            })}
          </ul>
          <div className="share-actions">
            <button type="button" disabled={imported === null} onClick={() => imported && onEdit(imported)}>
              この譜面を編集する
            </button>
            {imported === null && <p role="status">この譜面は、編集画面に持ち込めません。</p>}
          </div>
        </>
      )}
      <a href="/" onClick={goHome}>
        トップへ戻る
      </a>
    </main>
  );
}

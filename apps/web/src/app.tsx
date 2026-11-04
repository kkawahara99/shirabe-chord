import {
  MAX_PROGRESSION_CHORDS,
  MAX_PROGRESSION_LENGTH,
  optimizeProgression,
  type ChordParseFailure,
  type InvalidChord,
  type OptimizeProgressionResult,
} from "@shirabe-chord/core";
import { useEffect, useMemo, useState } from "react";
import { VoicingDiagram } from "./voicing-diagram.tsx";

const INITIAL_TEXT = "C Am F G7";
/** 入力が止まってから結果を出し直すまでの時間（ミリ秒）。 */
const DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

const PARSE_FAILURE_TEXT: Record<ChordParseFailure, string> = {
  empty: "空の記号です",
  "invalid-root": "ルート（C・D♭ など）を読めません",
  "unsupported-quality": "対応していない種類です",
  "invalid-tension": "対応していないテンションです",
  "duplicate-tension": "同じテンションが重なっています",
  "conflicting-tension": "テンションが矛盾しています",
  "invalid-bass": "ベース音（/ のあと）を読めません",
};

function describeInvalidChord({ index, symbol, reason }: InvalidChord): string {
  const head = `${index + 1}番目の記号「${symbol}」は`;
  return reason === "no-voicing"
    ? `${head}押さえ方が見つかりません`
    : `${head}読めません（${PARSE_FAILURE_TEXT[reason]}）`;
}

/** 失敗を、日本語の文の一覧にする。 */
function failureMessages(result: Extract<OptimizeProgressionResult, { ok: false }>): string[] {
  switch (result.reason) {
    case "empty":
      return ["コード進行を入力してください（例: C Am F G7）"];
    case "too-long":
      return [`入力が長すぎます（${MAX_PROGRESSION_LENGTH}文字まで）`];
    case "too-many-chords":
      return [`コードが多すぎます（${MAX_PROGRESSION_CHORDS}個まで）`];
    case "invalid-chords":
      return result.chords.map(describeInvalidChord);
  }
}

export function App() {
  const [text, setText] = useState(INITIAL_TEXT);
  const debouncedText = useDebounced(text, DEBOUNCE_MS);
  const result = useMemo(() => optimizeProgression(debouncedText), [debouncedText]);

  return (
    <main>
      <h1>shirabe-chord</h1>
      <p>コード進行を入れると、手の移動が少ない押さえ方の並びを出します。</p>
      <label htmlFor="progression">コード進行</label>
      <textarea
        id="progression"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-describedby="progression-hint"
      />
      <p id="progression-hint" className="hint">
        空白・改行・| で区切ります。
      </p>
      {result.ok ? (
        <div className="diagrams">
          {result.steps.map((step, i) => (
            <VoicingDiagram key={i} symbol={step.symbol} voicing={step.voicing} />
          ))}
        </div>
      ) : (
        <div role="alert" className="failures">
          <ul>
            {failureMessages(result).map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

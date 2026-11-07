import {
  buildChordSymbol,
  CAPO_FRETS,
  CHORD_QUALITIES,
  listShapesByLowestFret,
  lowerSymbol,
  MAX_PROGRESSION_CHORDS,
  optimizeSymbols,
  TENSIONS,
  tensionsConflictingWith,
  type Accidental,
  type ChordSelection,
  type InvalidChord,
  type NoteLetter,
  type NoteSelection,
  type OptimizeProgressionResult,
  type Shape,
  type Tension,
} from "@shirabe-chord/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { displayQuality, displaySymbol, displayTension } from "./display-symbol.ts";
import { handPositionLabel, progressionText } from "./progression-text.ts";
import { ShapePicker } from "./shape-picker.tsx";
import { VoicingDiagram } from "./voicing-diagram.tsx";

const LETTERS: readonly NoteLetter[] = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTALS: readonly { value: Accidental; label: string }[] = [
  { value: "", label: "なし" },
  { value: "#", label: "♯" },
  { value: "b", label: "♭" },
];

/** 種類の並びと見出し。`names` は記号に出す名前（`CHORD_QUALITIES` の `names[0]`）で、空文字は三和音の M。 */
const QUALITY_GROUPS: readonly { title: string; names: readonly string[] }[] = [
  { title: "三和音", names: ["", "m", "aug", "dim", "sus2", "sus4"] },
  { title: "7th", names: ["7", "M7", "m7", "mM7", "m7-5", "dim7", "7sus4"] },
  { title: "6・9・13 系", names: ["6", "m6", "9", "M9", "m9", "add9", "13"] },
];

// コアの種類の一覧が増えたのに、画面の選択肢が足りないとき、ここで気づく。
const listedNames = QUALITY_GROUPS.flatMap((g) => g.names);
if (
  listedNames.length !== CHORD_QUALITIES.length ||
  !CHORD_QUALITIES.every((q) => listedNames.includes(q.names[0]!))
) {
  throw new Error("画面の種類の選択肢が、コアの種類の一覧と食い違っています");
}
const TENSIONABLE = new Set(CHORD_QUALITIES.filter((q) => q.tensionable).map((q) => q.names[0]!));

const note = (letter: NoteLetter): NoteSelection => ({ letter, accidental: "" });
const INITIAL_CHORDS: readonly ChordSelection[] = [
  { root: note("C"), quality: "", tensions: [], bass: null },
  { root: note("A"), quality: "m", tensions: [], bass: null },
  { root: note("F"), quality: "", tensions: [], bass: null },
  { root: note("G"), quality: "7", tensions: [], bass: null },
];
const NEW_CHORD: ChordSelection = INITIAL_CHORDS[0]!;

/** 同時に使えないテンションは画面で選べないので、失敗は起きない。起きたら空の記号にして、図の失敗として出す。 */
function symbolOf(selection: ChordSelection): string {
  const built = buildChordSymbol(selection);
  return built.ok ? built.symbol : "";
}

/** 失敗の文には、画面に出している（鳴らす）名前を使う。カポで下げた形の記号ではなく。 */
function describeInvalidChord({ index, reason }: InvalidChord, played: readonly string[]): string {
  const head = `${index + 1}番目の記号「${displaySymbol(played[index]!)}」は`;
  return reason === "no-voicing" ? `${head}押さえ方が見つかりません` : `${head}読めません`;
}

/** 失敗を、日本語の文の一覧にする。 */
function failureMessages(
  result: Extract<OptimizeProgressionResult, { ok: false }>,
  played: readonly string[],
): string[] {
  switch (result.reason) {
    case "empty":
      return ["コードがありません"];
    case "too-long":
    case "too-many-chords":
      return [`コードが多すぎます（${MAX_PROGRESSION_CHORDS}個まで）`];
    case "invalid-pinned-voicing":
      return ["固定した押さえ方が合っていません"];
    case "invalid-chords":
      return result.chords.map((chord) => describeInvalidChord(chord, played));
  }
}

function RadioGroup<T extends string>(props: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="choices" disabled={props.disabled}>
      <legend>{props.legend}</legend>
      {props.options.map((option) => (
        <label key={option.value} className="choice">
          <input
            type="radio"
            name={props.name}
            checked={props.value === option.value}
            disabled={props.disabled}
            onChange={() => props.onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

const NO_BASS = "none";

/** 音名と変化記号の 2 組で音を選ぶ。`optional` が真なら、音名に「なし」を足す（ベース音。オンコードにしない）。 */
function NotePicker(props: {
  title: string;
  name: string;
  selected: NoteSelection | null;
  optional: boolean;
  onChange: (note: NoteSelection | null) => void;
}) {
  const { selected } = props;
  const letterOptions: { value: string; label: string }[] = LETTERS.map((l) => ({ value: l, label: l }));
  if (props.optional) letterOptions.push({ value: NO_BASS, label: "なし" });
  return (
    <>
      <RadioGroup
        legend={`${props.title}の音名`}
        name={`${props.name}-letter`}
        options={letterOptions}
        value={selected?.letter ?? NO_BASS}
        onChange={(value) =>
          props.onChange(
            value === NO_BASS ? null : { letter: value as NoteLetter, accidental: selected?.accidental ?? "" },
          )
        }
      />
      <RadioGroup
        legend={`${props.title}の変化記号`}
        name={`${props.name}-accidental`}
        options={ACCIDENTALS}
        value={selected?.accidental ?? ""}
        disabled={selected === null}
        onChange={(accidental) => selected && props.onChange({ ...selected, accidental })}
      />
    </>
  );
}

function ChordTab(props: { selection: ChordSelection; onChange: (selection: ChordSelection) => void }) {
  const { selection, onChange } = props;
  return (
    <>
      <NotePicker
        title="根音"
        name="root"
        selected={selection.root}
        optional={false}
        onChange={(root) => root && onChange({ ...selection, root })}
      />
      <fieldset className="choices">
        <legend>種類</legend>
        {QUALITY_GROUPS.map((qualityGroup, i) => (
          <div key={qualityGroup.title} role="group" aria-labelledby={`quality-group-${i}`} className="quality-group">
            <span id={`quality-group-${i}`} className="quality-group-title">
              {qualityGroup.title}
            </span>
            <div className="quality-chips">
              {qualityGroup.names.map((name) => (
                <label key={name} className="choice">
                  <input
                    type="radio"
                    name="quality"
                    checked={selection.quality === name}
                    onChange={() =>
                      onChange({
                        ...selection,
                        quality: name,
                        tensions: TENSIONABLE.has(name) ? selection.tensions : [],
                      })
                    }
                  />
                  {displayQuality(name)}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
    </>
  );
}

function ExtrasTab(props: { selection: ChordSelection; onChange: (selection: ChordSelection) => void }) {
  const { selection, onChange } = props;
  const tensionable = TENSIONABLE.has(selection.quality);
  const blocked = new Set<Tension>(selection.tensions.flatMap((t) => tensionsConflictingWith(t)));

  const toggleTension = (tension: Tension, checked: boolean) =>
    onChange({
      ...selection,
      tensions: checked ? [...selection.tensions, tension] : selection.tensions.filter((t) => t !== tension),
    });

  return (
    <>
      <fieldset className="choices" disabled={!tensionable}>
        <legend>テンション</legend>
        {TENSIONS.map((tension) => (
          <label key={tension} className="choice">
            <input
              type="checkbox"
              checked={selection.tensions.includes(tension)}
              disabled={!tensionable || blocked.has(tension)}
              onChange={(event) => toggleTension(tension, event.target.checked)}
            />
            {displayTension(tension)}
          </label>
        ))}
      </fieldset>
      <NotePicker
        title="ベース音"
        name="bass"
        selected={selection.bass}
        optional
        onChange={(bass) => onChange({ ...selection, bass })}
      />
    </>
  );
}

type EditorTab = "chord" | "extras" | "shape";
const TAB_LABELS: Record<EditorTab, string> = { chord: "コード", extras: "テンション・ベース", shape: "押さえ方" };

export function App() {
  const [chords, setChords] = useState<readonly ChordSelection[]>(INITIAL_CHORDS);
  /** 選んでいるコードの番号。パネルを閉じている間も覚えておく。 */
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<EditorTab>("chord");

  /**
   * 固定した押さえ方。進行の位置（0 始まり）→ 形。無い位置は「おまかせ」。
   * 記号が変わった位置は外す・コードを削除したら後ろを 1 つ詰める・カポを変えたらすべて外す（ADR 0033）。
   */
  const [pins, setPins] = useState<ReadonlyMap<number, Shape>>(new Map());

  /** コピーの結果。進行や手の位置が変わったら消す（古い成功を残さない）。 */
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);

  /** カポの位置（0 はカポなし）。保存しない。進行の記号は鳴らす名前のままで、押さえ方はカポをナットとみなして求める。 */
  const [capo, setCapo] = useState(0);

  const cardButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const closeButton = useRef<HTMLButtonElement>(null);
  /** 描画のあとでフォーカスを移す先。開閉の操作の時点では、移す先の要素がまだ無い（開くとき）か、まだ残っている（閉じるとき）。 */
  const pendingFocus = useRef<"card" | "close" | null>(null);
  useEffect(() => {
    if (pendingFocus.current === "card") cardButtons.current[selected]?.focus();
    if (pendingFocus.current === "close") closeButton.current?.focus();
    pendingFocus.current = null;
  });

  const symbols = chords.map(symbolOf);
  const joined = symbols.join(" ");
  /** カポ基準の「形の記号」。押さえ方の計算・図・ルートの印は、これで行う。 */
  const shapeSymbols = symbols.map((symbol) => lowerSymbol(symbol, capo));
  const shapeJoined = shapeSymbols.join(" ");
  const shapes = useMemo(() => listShapesByLowestFret(shapeSymbols[selected]!), [shapeSymbols[selected]]); // eslint-disable-line react-hooks/exhaustive-deps -- 選んでいるコードの記号が同じなら計算し直さない
  const firstShapes = useMemo(() => listShapesByLowestFret(shapeSymbols[0]!), [shapeSymbols[0]]); // eslint-disable-line react-hooks/exhaustive-deps -- 先頭の記号が同じなら計算し直さない
  const result = useMemo(
    () => optimizeSymbols(shapeSymbols, { pins: new Map([...pins].map(([position, shape]) => [position, shape.voicing])) }),
    [shapeJoined, pins], // eslint-disable-line react-hooks/exhaustive-deps -- 記号の中身が同じなら計算し直さない
  );

  /** 手の位置は、固定のうち進行の先頭に最も近いものの最低フレット（コアの窓の基準と同じ）。固定が無ければ `null`（おまかせ）。 */
  const frontPin = Math.min(...pins.keys());
  const handPosition = pins.size === 0 ? null : pins.get(frontPin)!.lowestFret;
  /** 手の位置のボタンで移るコード。固定が無ければ 1 番目。 */
  const handTarget = pins.size === 0 ? 0 : frontPin;

  useEffect(() => setCopyStatus(null), [joined, capo, pins]);

  const copyText = async () => {
    if (!result.ok) return;
    try {
      await navigator.clipboard.writeText(progressionText(handPosition, result.steps, capo > 0 ? { fret: capo, played: symbols } : undefined));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed"); // クリップボードが無い環境（TypeError）も、書き込みの拒否もここに来る
    }
  };

  const hasShapes = shapes.ok && shapes.shapes.length > 0;
  /** 手の位置のボタンは、移る先のコードに候補があるときだけ押せる（固定したコードには、必ず候補がある）。 */
  const handTargetHasShapes = pins.size > 0 || (firstShapes.ok && firstShapes.shapes.length > 0);
  /** 「押さえ方」タブは、選んでいるコードに候補があるときだけ出せる。 */
  const shapeTabAvailable = hasShapes;
  const shownTab: EditorTab = tab === "shape" && !shapeTabAvailable ? "chord" : tab;
  const tabs: EditorTab[] = shapeTabAvailable ? ["chord", "extras", "shape"] : ["chord", "extras"];

  /** 選ぶコードを変えるとき、タブを「コード」に戻す（同じコードを選び直すときは戻さない）。 */
  const chooseChord = (index: number) => {
    if (index !== selected) setTab("chord");
    setSelected(index);
    setOpen(true);
  };
  const addChord = () => {
    setChords([...chords, NEW_CHORD]);
    chooseChord(chords.length);
  };
  const removeChord = (index: number) => {
    setChords(chords.filter((_, i) => i !== index));
    // 削除したコードの固定は消え、後ろの固定は 1 つ前に詰まる（固定は固定したコードに付いたまま動く）。
    setPins(new Map([...pins].filter(([position]) => position !== index).map(([position, shape]) => [position > index ? position - 1 : position, shape])));
    if (index < selected) setSelected(selected - 1);
    else if (index === selected) {
      setSelected(Math.max(0, index - 1));
      setTab("chord");
    }
  };
  /** `shape` が `null` なら、その位置を「おまかせ」に戻す。 */
  const setPin = (position: number, shape: Shape | null) => {
    if (!shape && !pins.has(position)) return; // 変わらないときは、計算し直さない・コピーの結果の文を消さない
    const next = new Map(pins);
    if (shape) next.set(position, shape);
    else next.delete(position);
    setPins(next);
  };
  const changeCapo = (fret: number) => {
    setCapo(fret);
    setPins(new Map()); // 固定した押さえ方は、前のカポの形の記号に対するもの
  };
  const changeSelected = (selection: ChordSelection) => {
    if (symbolOf(selection) !== symbols[selected]) setPin(selected, null); // 固定した押さえ方は、前の記号に対するもの
    setChords(chords.map((chord, i) => (i === selected ? selection : chord)));
  };
  const closePanel = () => {
    pendingFocus.current = "card";
    setOpen(false);
  };
  const openFromRail = () => {
    pendingFocus.current = "close";
    setOpen(true);
  };
  const showHandPosition = () => {
    setSelected(handTarget);
    setTab("shape");
    setOpen(true);
  };

  return (
    <div className="app">
      <header className="site-header">
        <div className="site-title">
          <h1>Shirabeコード</h1>
          <p>コード進行を組み立てると、手の移動が少ない押さえ方の並びを出します。</p>
        </div>
        <label className="capo-picker">
          カポ
          <select value={capo} onChange={(event) => changeCapo(Number(event.target.value))}>
            {CAPO_FRETS.map((fret) => (
              <option key={fret} value={fret}>
                {fret === 0 ? "なし" : fret}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="hand-button" disabled={!handTargetHasShapes} onClick={showHandPosition}>
          手の位置：{handPositionLabel(handPosition)}
        </button>
        <section aria-label="押さえ方の選び方" className="how">
          <details>
            <summary>選び方</summary>
            <ul>
              <li>押さえ方は、手の移動が少なくなるように、進行全体で選びます。</li>
              <li>同じコードが離れて出てきても、同じ押さえ方になるとは限りません（弾きやすい方を優先します）。</li>
              <li>
                押さえ方を固定すると、固定したうち最も前のコードの最低フレットから5フレット分に、固定していないコードを収めます。開放弦とミュートは位置に関係なく使います。収まる押さえ方が無いコードだけ、範囲を広げて選びます（「手の位置から外れた押さえ方です」と出ます）。
              </li>
              <li>押さえ方は、どのコードでも選び直せます。</li>
              <li>標準チューニングの右利きのギターを前提にしています。</li>
            </ul>
          </details>
        </section>
      </header>
      <div className="body">
        <aside className={open ? "panel" : "panel closed"}>
          {open ? (
            <section aria-labelledby="editor-title" className="editor">
              <div className="editor-head">
                <h2 id="editor-title">{selected + 1}番目のコードを編集</h2>
                <span className="editor-symbol">{displaySymbol(symbols[selected]!)}</span>
                <button type="button" ref={closeButton} onClick={closePanel}>
                  閉じる
                </button>
              </div>
              <div role="group" aria-label="編集の項目" className="tabs">
                {tabs.map((name) => (
                  <button key={name} type="button" aria-pressed={name === shownTab} onClick={() => setTab(name)}>
                    {TAB_LABELS[name]}
                  </button>
                ))}
              </div>
              <div className="tab-body">
                {shownTab === "chord" && <ChordTab selection={chords[selected]!} onChange={changeSelected} />}
                {shownTab === "extras" && <ExtrasTab selection={chords[selected]!} onChange={changeSelected} />}
                {shownTab === "shape" && shapes.ok && (
                  <ShapePicker
                    symbol={shapeSymbols[selected]!}
                    shapes={shapes.shapes}
                    pickedIndex={pins.get(selected)?.candidateIndex ?? null}
                    onPick={(shape) => setPin(selected, shape)}
                  />
                )}
              </div>
            </section>
          ) : (
            <button type="button" className="rail-button" onClick={openFromRail}>
              編集を開く
            </button>
          )}
        </aside>
        <section aria-label="進行の押さえ方" className="score">
          <div className="score-actions">
            <button type="button" disabled={!result.ok} onClick={() => window.print()}>
              印刷
            </button>
            <button type="button" disabled={!result.ok} onClick={copyText}>
              テキストでコピー
            </button>
            <p role="status">
              {copyStatus === "copied" && "コピーしました"}
              {copyStatus === "failed" && "コピーできませんでした"}
            </p>
          </div>
          {capo > 0 && <p className="capo-note">カポ{capo}</p>}
          {!result.ok && (
            <div role="alert" className="failures">
              <ul>
                {failureMessages(result, symbols).map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          <ul className="steps" aria-label="コード進行">
            {symbols.map((symbol, i) => {
              const step = result.ok ? result.steps[i] : undefined;
              return (
                <li key={i} className="step">
                  <span className="step-number">{i + 1}</span>
                  <button
                    type="button"
                    className="step-select"
                    ref={(element) => {
                      cardButtons.current[i] = element;
                    }}
                    aria-pressed={open && i === selected}
                    data-symbol={symbol}
                    onClick={() => chooseChord(i)}
                  >
                    {displaySymbol(symbol)}
                  </button>
                  {pins.has(i) && <span className="step-pinned">固定</span>}
                  {step && <VoicingDiagram symbol={step.symbol} voicing={step.voicing} hideCaption />}
                  {step && capo > 0 && <p className="step-shape">{displaySymbol(step.symbol)}の形</p>}
                  {step?.inWindow === false && <p className="out-of-window">手の位置から外れた押さえ方です</p>}
                  <button
                    type="button"
                    className="step-remove"
                    aria-label={`${i + 1}番目のコードを削除`}
                    disabled={chords.length <= 1}
                    onClick={() => removeChord(i)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
            <li className="step-add">
              <button type="button" disabled={chords.length >= MAX_PROGRESSION_CHORDS} onClick={addChord}>
                ＋ コードを追加
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

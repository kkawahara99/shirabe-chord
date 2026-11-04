import {
  buildChordSymbol,
  CHORD_QUALITIES,
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
  type Tension,
} from "@shirabe-chord/core";
import { useMemo, useState } from "react";
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

function describeInvalidChord({ index, symbol, reason }: InvalidChord): string {
  const head = `${index + 1}番目の記号「${symbol}」は`;
  return reason === "no-voicing" ? `${head}押さえ方が見つかりません` : `${head}読めません`;
}

/** 失敗を、日本語の文の一覧にする。 */
function failureMessages(result: Extract<OptimizeProgressionResult, { ok: false }>): string[] {
  switch (result.reason) {
    case "empty":
      return ["コードがありません"];
    case "too-long":
    case "too-many-chords":
      return [`コードが多すぎます（${MAX_PROGRESSION_CHORDS}個まで）`];
    case "invalid-chords":
      return result.chords.map(describeInvalidChord);
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

function ChordEditor(props: { selection: ChordSelection; onChange: (selection: ChordSelection) => void }) {
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
                {name === "" ? "M" : name}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
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
            {tension}
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

export function App() {
  const [chords, setChords] = useState<readonly ChordSelection[]>(INITIAL_CHORDS);
  const [selected, setSelected] = useState(0);

  const symbols = chords.map(symbolOf);
  const result = useMemo(() => optimizeSymbols(symbols), [symbols.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps -- 記号の中身が同じなら計算し直さない

  const addChord = () => {
    setChords([...chords, NEW_CHORD]);
    setSelected(chords.length);
  };
  const removeChord = (index: number) => {
    setChords(chords.filter((_, i) => i !== index));
    if (index < selected) setSelected(selected - 1);
    else if (index === selected) setSelected(Math.max(0, index - 1));
  };
  const changeSelected = (selection: ChordSelection) =>
    setChords(chords.map((chord, i) => (i === selected ? selection : chord)));

  return (
    <main>
      <h1>shirabe-chord</h1>
      <p>コード進行を組み立てると、手の移動が少ない押さえ方の並びを出します。</p>
      <ul className="chords" aria-label="コード進行">
        {symbols.map((symbol, i) => (
          <li key={i} className="chord-item">
            <button type="button" aria-pressed={i === selected} onClick={() => setSelected(i)}>
              {symbol}
            </button>
            <button
              type="button"
              aria-label={`${i + 1}番目のコードを削除`}
              disabled={chords.length <= 1}
              onClick={() => removeChord(i)}
            >
              ×
            </button>
          </li>
        ))}
        <li>
          <button type="button" disabled={chords.length >= MAX_PROGRESSION_CHORDS} onClick={addChord}>
            ＋ コードを追加
          </button>
        </li>
      </ul>
      <section aria-labelledby="editor-title">
        <h2 id="editor-title">{selected + 1}番目のコードを編集</h2>
        <ChordEditor selection={chords[selected]!} onChange={changeSelected} />
      </section>
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

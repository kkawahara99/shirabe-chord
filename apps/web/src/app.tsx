import {
  buildChordSymbol,
  CAPO_FRETS,
  CHORD_QUALITIES,
  listShapesByLowestFret,
  lowerSymbol,
  MAX_PROGRESSION_CHORDS,
  optimizeSymbols,
  soundingNotes,
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
import { AuthControl } from "./auth-control.tsx";
import { readAuthConfig, type AuthConfig } from "./auth-config.ts";
import { AuthProvider } from "./auth-context.tsx";
import { displayQuality, displaySymbol, displayTension } from "./display-symbol.ts";
import { Icon } from "./icon.tsx";
import type { ImportedScore } from "./import-score.ts";
import { parseLoginReturn } from "./login.ts";
import { handPositionLabel, progressionText } from "./progression-text.ts";
import { pinMarksOf, readSnapshot, restorePins, type AfterAction } from "./resume.ts";
import { normalizeTempo, DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO } from "./tempo.ts";
import { usePlayback } from "./use-playback.ts";
import { MinePage } from "./mine-page.tsx";
import { parseRoute } from "./route.ts";
import { browserStorage } from "./session-store.ts";
import { ShapePicker } from "./shape-picker.tsx";
import { ShareDialog } from "./share-dialog.tsx";
import { SharePage } from "./share-page.tsx";
import { VoicingDiagram } from "./voicing-diagram.tsx";

const LETTERS: readonly NoteLetter[] = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTALS: readonly { value: Accidental; label: string }[] = [
  { value: "", label: "なし" },
  { value: "#", label: "♯" },
  { value: "b", label: "♭" },
];

/**
 * 種類の並びと見出し。`names` は記号に出す名前（`CHORD_QUALITIES` の `names[0]`）で、空文字は三和音の M。
 * `basic` は初めから出す名前、`more` は「…」で開くと加わる名前。
 */
const QUALITY_GROUPS: readonly { title: string; basic: readonly string[]; more: readonly string[] }[] = [
  { title: "三和音", basic: ["", "m"], more: ["aug", "dim", "sus2", "sus4"] },
  { title: "7th", basic: ["7", "M7", "m7"], more: ["mM7", "m7-5", "dim7", "7sus4"] },
  { title: "6・9・13 系", basic: [], more: ["6", "m6", "9", "M9", "m9", "add9", "13"] },
];

// コアの種類の一覧が増えたのに、画面の選択肢が足りないとき、ここで気づく。
const listedNames = QUALITY_GROUPS.flatMap((g) => [...g.basic, ...g.more]);
const HIDDEN_QUALITIES = new Set(QUALITY_GROUPS.flatMap((g) => g.more));
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
  /** 「…」を手で開いたか。この部品はコードやタブを替えると作り直されるので、そのとき捨てられ、選んでいる種類で決め直される。 */
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const hiddenSelected = HIDDEN_QUALITIES.has(selection.quality);
  const expanded = manuallyOpen || hiddenSelected;
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
        {QUALITY_GROUPS.map((qualityGroup, i) => {
          const names = expanded ? [...qualityGroup.basic, ...qualityGroup.more] : qualityGroup.basic;
          if (names.length === 0) return null;
          return (
          <div key={qualityGroup.title} role="group" aria-labelledby={`quality-group-${i}`} className="quality-group">
            <span id={`quality-group-${i}`} className="quality-group-title">
              {qualityGroup.title}
            </span>
            <div className="quality-chips">
              {names.map((name) => (
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
          );
        })}
        <button
          type="button"
          className="more-qualities"
          aria-label="ほかの種類"
          aria-expanded={expanded}
          disabled={hiddenSelected}
          onClick={() => setManuallyOpen(!manuallyOpen)}
        >
          …
        </button>
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

const DEFAULT_CONFIG = readAuthConfig(import.meta.env);

export type AppProps = {
  /** ログインと共有の設定。既定はビルド時の環境変数。`null`（空）ならログインと共有の画面を出さない。 */
  config?: AuthConfig | null;
  /** 別のページへ移る。既定は `location.assign`。 */
  goTo?: (url: string) => void;
};

export function App({ config = DEFAULT_CONFIG, goTo = (url) => window.location.assign(url) }: AppProps = {}) {
  /** 起動時の URL にあるログインの戻り。戻り先は `/` なので、それ以外のパスでは読まない。設定が空でも読まない。 */
  const [back] = useState(() =>
    config && window.location.pathname === "/" ? parseLoginReturn(window.location.search) : ({ kind: "none" } as const),
  );
  /** ログインから戻ったときだけ、退避した入力を読む（戻りでないときの古い退避は使わない）。 */
  const [restored] = useState(() => (back.kind === "none" ? null : readSnapshot(browserStorage())));

  const [chords, setChords] = useState<readonly ChordSelection[]>(restored?.chords ?? INITIAL_CHORDS);
  /** 選んでいるコードの番号。パネルを閉じている間も覚えておく。 */
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<EditorTab>("chord");
  const [editEpoch, setEditEpoch] = useState(0);

  /**
   * 固定した押さえ方。進行の位置（0 始まり）→ 形。無い位置は「おまかせ」。
   * 記号が変わった位置は外す・コードを削除したら後ろを 1 つ詰める・カポを変えたらすべて外す（ADR 0033）。
   */
  const [pins, setPins] = useState<ReadonlyMap<number, Shape>>(() =>
    restored ? restorePins(restored.chords, restored.capo, restored.pins) : new Map(),
  );

  /** コピーの結果。進行や手の位置が変わったら消す（古い成功を残さない）。 */
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | null>(null);

  /** カポの位置（0 はカポなし）。保存しない。進行の記号は鳴らす名前のままで、押さえ方はカポをナットとみなして求める。 */
  const [capo, setCapo] = useState(restored?.capo ?? 0);

  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string) => {
    window.history.pushState(null, "", to);
    setPath(to);
  };
  /** 設定が空のあいだは、`/mine` などを開いてもトップを出す。 */
  const route = config ? parseRoute(path) : ({ kind: "home" } as const);
  const [shareOpen, setShareOpen] = useState(false);
  // ブラウザの戻る・進むで別の画面になったら、ダイアログを残さない
  useEffect(() => {
    if (route.kind !== "home") setShareOpen(false);
  }, [route.kind]);
  const resume = (action: AfterAction) => {
    if (action === "mine") navigate("/mine");
    else setShareOpen(true);
  };

  const cardButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const closeButton = useRef<HTMLButtonElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  /** 描画のあとでフォーカスを移す先。開閉の操作の時点では、移す先の要素がまだ無い（開くとき）か、まだ残っている（閉じるとき）。 */
  const pendingFocus = useRef<"card" | "close" | "share" | null>(null);
  useEffect(() => {
    if (pendingFocus.current === "card") cardButtons.current[selected]?.focus();
    if (pendingFocus.current === "close") closeButton.current?.focus();
    if (pendingFocus.current === "share") shareButton.current?.focus(); // ダイアログが閉じて、後ろの画面が操作できるようになってから
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

  const sound = usePlayback();
  /** テンポの入力欄の文字。丸めるのは、フォーカスが外れたときと再生を押したとき。 */
  const [tempoText, setTempoText] = useState(String(DEFAULT_TEMPO));
  const [loop, setLoop] = useState(false);
  // 進行・カポ・固定が変わったら止める（鳴らしている押さえ方が、画面のものと食い違うため）。別の画面へ移っても止める（操作列が消えて止められなくなる）
  useEffect(() => sound.stop(), [joined, capo, pins, route.kind]); // eslint-disable-line react-hooks/exhaustive-deps -- stop は変わらない
  const soundDisabled = !result.ok || sound.unavailable;
  const playProgression = () => {
    if (!result.ok) return;
    const tempo = normalizeTempo(tempoText);
    setTempoText(String(tempo));
    sound.playProgression(
      result.steps.map((step) => soundingNotes(step.voicing, capo)),
      { tempo, loop },
    );
  };
  const playChord = (index: number) => {
    if (result.ok) sound.playChord(soundingNotes(result.steps[index]!.voicing, capo));
  };

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
    setEditEpoch(editEpoch + 1); // 番号が同じまま編集するコードが替わることがあるので、種類の開閉も決め直す
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
  const closeShare = () => {
    pendingFocus.current = "share";
    setShareOpen(false);
  };
  /** 共有された譜面を、編集画面の状態にして、トップへ移る。共有元は変わらない。 */
  const bringIn = (imported: ImportedScore) => {
    setChords(imported.chords);
    setCapo(imported.capo);
    setPins(new Map(imported.pins));
    setSelected(0);
    setTab("chord");
    setOpen(true);
    navigate("/");
  };
  /** 共有に送る各コード。記号は鳴らす名前、押さえ方はカポをナットとみなした形。組み立てに失敗しているときは `null`。 */
  const shareChords = shareOpen && result.ok ? symbols.map((symbol, i) => ({ symbol, voicing: result.steps[i]!.voicing })) : null;

  const app = (
    <div className="app" inert={shareOpen}>
      <header className="site-header">
        <div className="site-title">
          <h1>Shirabeコード</h1>
          <p>コード進行から、弾きやすい押さえ方を生成♪</p>
        </div>
        {route.kind === "home" && (
          <>
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
          </>
        )}
        {config && <AuthControl onOpenMine={() => navigate("/mine")} />}
      </header>
      {route.kind === "mine" && <MinePage onHome={() => navigate("/")} onOpen={(id) => navigate(`/s/${id}`)} />}
      {route.kind === "share" && <SharePage key={route.id} id={route.id} onHome={() => navigate("/")} onEdit={bringIn} />}
      {route.kind === "home" && (
        <div className="body">
          <aside className={open ? "panel" : "panel closed"}>
            {open ? (
              <section aria-labelledby="editor-title" className="editor">
                <div className="editor-head">
                  <h2 id="editor-title">{selected + 1}番目のコードを編集</h2>
                  <span className="editor-symbol">{displaySymbol(symbols[selected]!)}</span>
                  <button type="button" ref={closeButton} onClick={closePanel}>
                    <Icon name="close" />
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
                  {shownTab === "chord" && <ChordTab key={`${selected}-${editEpoch}`} selection={chords[selected]!} onChange={changeSelected} />}
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
                <Icon name="print" />
                印刷
              </button>
              <button type="button" disabled={!result.ok} onClick={copyText}>
                <Icon name="copy" />
                テキストでコピー
              </button>
              {config && (
                <button type="button" ref={shareButton} disabled={!result.ok} onClick={() => setShareOpen(true)}>
                  <Icon name="share" />
                  共有する
                </button>
              )}
              <p role="status">
                {copyStatus === "copied" && "コピーしました"}
                {copyStatus === "failed" && "コピーできませんでした"}
              </p>
              <button type="button" disabled={soundDisabled} onClick={playProgression}>
                <Icon name="play" />
                進行を鳴らす
              </button>
              <button type="button" disabled={!sound.state.playing} onClick={sound.stop}>
                <Icon name="stop" />
                止める
              </button>
              <label className="tempo">
                テンポ
                <input
                  type="number"
                  min={MIN_TEMPO}
                  max={MAX_TEMPO}
                  step="any"
                  value={tempoText}
                  disabled={sound.state.playing}
                  aria-describedby="tempo-range"
                  onChange={(event) => setTempoText(event.target.value)}
                  onBlur={() => setTempoText(String(normalizeTempo(tempoText)))}
                />
                <span id="tempo-range">（{MIN_TEMPO}〜{MAX_TEMPO}）</span>
              </label>
              <label className="choice">
                <input type="checkbox" checked={loop} disabled={sound.state.playing} onChange={(event) => setLoop(event.target.checked)} />
                ループ
              </label>
              {sound.unavailable && <p className="sound-note">この環境では音を出せません</p>}
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
                  <li key={i} className={sound.state.active === i ? "step playing" : "step"}>
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
                    {step && <VoicingDiagram symbol={step.symbol} voicing={step.voicing} hideCaption showFingers />}
                    {step && capo > 0 && <p className="step-shape">{displaySymbol(step.symbol)}の形</p>}
                    {step?.inWindow === false && <p className="out-of-window">手の位置から外れた押さえ方です</p>}
                    <button type="button" className="step-play" disabled={soundDisabled} onClick={() => playChord(i)}>
                      <Icon name="play" />
                      鳴らす
                    </button>
                    <button
                      type="button"
                      className="step-remove"
                      aria-label={`${i + 1}番目のコードを削除`}
                      disabled={chords.length <= 1}
                      onClick={() => removeChord(i)}
                    >
                      <Icon name="trash" />
                    </button>
                  </li>
                );
              })}
              <li className="step-add">
                <button type="button" disabled={chords.length >= MAX_PROGRESSION_CHORDS} onClick={addChord}>
                  <Icon name="add" />
                  コードを追加
                </button>
              </li>
            </ul>
          </section>
        </div>
      )}
      <footer className="site-footer">
        {route.kind === "home" && (
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
        )}
        {config && <a href="/privacy.html">プライバシーポリシー</a>}
      </footer>
    </div>
  );
  const page = (
    <>
      {app}
      {config && shareOpen && (
        <ShareDialog
          chords={shareChords}
          capo={capo}
          siteKey={config.turnstileSiteKey}
          onClose={closeShare}
          onOpenMine={() => {
            setShareOpen(false);
            navigate("/mine");
          }}
        />
      )}
    </>
  );

  if (!config) return page;
  return (
    <AuthProvider
      config={config}
      back={back}
      after={restored?.after ?? null}
      captureSnapshot={(after) => ({ chords, capo, pins: pinMarksOf(pins), after })}
      onResume={resume}
      goTo={goTo}
    >
      {page}
    </AuthProvider>
  );
}

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseChord } from "./chord.ts";
import { CAPO_FRETS, lowerSymbol } from "./chord-transpose.ts";
import {
  ANONYMOUS_NAME,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SYMBOL_LENGTH,
  MAX_TITLE_LENGTH,
  validateSharedScore,
  type SharedScoreFailure,
} from "./shared-score.ts";
import { MAX_PROGRESSION_CHORDS } from "./progression.ts";
import { chord, chordSymbols, v } from "./test-helpers.ts";
import { generateVoicings } from "./voicing.ts";

const validScore = () => ({
  title: "朝の曲",
  note: "サビは強めに",
  displayName: "作曲者",
  capo: 0,
  chords: [
    { symbol: "C", voicing: v("x32010") },
    { symbol: "G", voicing: v("320003") },
  ],
});

/** 落ちた理由。通ったら "ok"。 */
function verdict(value: unknown): SharedScoreFailure | "ok" {
  const result = validateSharedScore(value);
  return result.ok ? "ok" : result.reason;
}

const withField = (field: string, value: unknown) => ({ ...validScore(), [field]: value });
const chordsOf = (n: number) => Array.from({ length: n }, () => ({ symbol: "C", voicing: v("x32010") }));

describe("validateSharedScore: 通るもの", () => {
  it("カポなしの正しい譜面が通り、同じ値が型付きで返る", () => {
    const result = validateSharedScore(validScore());
    expect(result).toEqual({ ok: true, score: validScore() });
  });

  it("カポ3の譜面（鳴らす記号 Bb Eb F Bb、G の形の押さえ方）が通る", () => {
    const score = {
      ...validScore(),
      capo: 3,
      chords: [
        { symbol: "Bb", voicing: v("320003") },
        { symbol: "Eb", voicing: v("x32010") },
        { symbol: "F", voicing: v("xx0232") },
        { symbol: "Bb", voicing: v("320003") },
      ],
    };
    expect(validateSharedScore(score)).toEqual({ ok: true, score });
  });

  it("ひと言は省略でき、空文字になる", () => {
    const { note: _note, ...rest } = validScore();
    const result = validateSharedScore(rest);
    expect(result.ok && result.score.note).toBe("");
  });

  it.each([undefined, "", "   ", "　"])("表示名 %j は「匿名」になる", (displayName) => {
    const result = validateSharedScore(withField("displayName", displayName));
    expect(result.ok && result.score.displayName).toBe(ANONYMOUS_NAME);
    expect(ANONYMOUS_NAME).toBe("匿名");
  });

  it("ひと言の LF 改行は通る", () => {
    const result = validateSharedScore(withField("note", "1行目\n2行目"));
    expect(result.ok && result.score.note).toBe("1行目\n2行目");
  });

  it("上限ちょうど（タイトル50字・ひと言200字・表示名20字・コード64個）は通る", () => {
    expect([MAX_TITLE_LENGTH, MAX_NOTE_LENGTH, MAX_DISPLAY_NAME_LENGTH]).toEqual([50, 200, 20]);
    // カポ7の G は C の形
    const chords = Array.from({ length: MAX_PROGRESSION_CHORDS }, () => ({ symbol: "G", voicing: v("x32010") }));
    const score = { title: "あ".repeat(50), note: "い".repeat(200), displayName: "う".repeat(20), capo: 7, chords };
    expect(verdict(score)).toBe("ok");
  });

  it("文字数はコードポイント単位で数える（絵文字・サロゲートペアも1字）", () => {
    expect(verdict(withField("title", "🎸".repeat(50)))).toBe("ok");
    expect(verdict(withField("title", "🎸".repeat(51)))).toBe("invalid-title");
    expect(verdict(withField("note", "𠮷".repeat(200)))).toBe("ok");
    expect(verdict(withField("displayName", "😀".repeat(20)))).toBe("ok");
  });

  it("余分なフィールド（譜面・各コード）は落とさず、結果に残らない", () => {
    const score = {
      ...validScore(),
      owner: "sub-123",
      extra: { nested: 1 },
      chords: validScore().chords.map((c) => ({ ...c, label: "x", displaySymbol: "C♯" })),
    };
    expect(validateSharedScore(score)).toEqual({ ok: true, score: validScore() });
  });

  it("入力を書き換えず、結果は入力と参照を共有しない", () => {
    const input = validScore();
    const snapshot = JSON.parse(JSON.stringify(input));
    const result = validateSharedScore(input);
    expect(input).toEqual(snapshot);
    if (!result.ok) throw new Error("通るはず");
    expect(result.score.chords).not.toBe(input.chords);
    expect(result.score.chords[0]).not.toBe(input.chords[0]);
    expect(result.score.chords[0]!.voicing).not.toBe(input.chords[0]!.voicing);
  });
});

describe("validateSharedScore: 落ちるもの", () => {
  it.each([[null], [undefined], [[]], ["譜面"], [42], [true]])("オブジェクトでない値 %j は invalid-shape", (value) => {
    expect(verdict(value)).toBe("invalid-shape");
  });

  it.each([
    ["title", 1, "invalid-title"],
    ["note", 1, "invalid-note"],
    ["note", null, "invalid-note"],
    ["displayName", 1, "invalid-display-name"],
    ["displayName", null, "invalid-display-name"],
    ["capo", "3", "invalid-capo"],
    ["chords", "C G", "invalid-chord-count"],
    ["chords", { length: 2 }, "invalid-chord-count"],
    ["chords", [null], "invalid-symbol"],
    ["chords", [{ symbol: 1, voicing: v("x32010") }], "invalid-symbol"],
    ["chords", [{ symbol: "C", voicing: "x32010" }], "invalid-voicing"],
    ["chords", [{ symbol: "C" }], "invalid-voicing"],
  ] as const)("フィールド %s が %j なら %s", (field, value, reason) => {
    expect(verdict(withField(field, value))).toBe(reason);
  });

  it("タイトルが無い・空・空白だけなら invalid-title", () => {
    const { title: _title, ...rest } = validScore();
    expect(verdict(rest)).toBe("invalid-title");
    for (const title of ["", " ", "　　", " \t "]) {
      expect(verdict(withField("title", title))).toBe("invalid-title");
    }
  });

  it("タイトルが51字、改行・制御文字を含むと invalid-title", () => {
    expect(verdict(withField("title", "a".repeat(51)))).toBe("invalid-title");
    for (const title of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u007fb", "a\u0085b"]) {
      expect(verdict(withField("title", title))).toBe("invalid-title");
    }
  });

  it("ひと言が201字、LF 以外の制御文字（CR 含む）を含むと invalid-note", () => {
    expect(verdict(withField("note", "a".repeat(201)))).toBe("invalid-note");
    for (const note of ["a\rb", "a\r\nb", "a\tb", "a\u0000b", "a\u001bb"]) {
      expect(verdict(withField("note", note))).toBe("invalid-note");
    }
  });

  it("表示名が21字、改行・制御文字を含むと invalid-display-name", () => {
    expect(verdict(withField("displayName", "a".repeat(21)))).toBe("invalid-display-name");
    for (const displayName of ["a\nb", "a\rb", "a\tb", "a\u0000b"]) {
      expect(verdict(withField("displayName", displayName))).toBe("invalid-display-name");
    }
  });

  it("行区切り・段落区切り（U+2028・U+2029）は、どの文字欄でも拒否する", () => {
    for (const separator of ["\u2028", "\u2029"]) {
      expect(verdict(withField("title", `a${separator}b`))).toBe("invalid-title");
      expect(verdict(withField("note", `a${separator}b`))).toBe("invalid-note");
      expect(verdict(withField("displayName", `a${separator}b`))).toBe("invalid-display-name");
    }
  });

  it("向きを変える制御文字（RLO など）は、どの文字欄でも拒否する", () => {
    expect(verdict(withField("title", "a\u202eb"))).toBe("invalid-title");
    expect(verdict(withField("note", "a\u2066b"))).toBe("invalid-note");
    expect(verdict(withField("displayName", "a\u202ab"))).toBe("invalid-display-name");
  });

  it.each(["B♭", "F♯m7(♭5)", "Ｃ", " C", "C "])("表示用・全角・空白付きの記号 %j は、読めても保存しない（invalid-symbol）", (symbol) => {
    expect(verdict(withField("chords", [{ symbol, voicing: v("x32010") }]))).toBe("invalid-symbol");
  });

  it("孤立サロゲートを含む文字は、どの文字欄でも拒否する", () => {
    expect(verdict(withField("title", "a\ud83db"))).toBe("invalid-title");
    expect(verdict(withField("note", "\ude00"))).toBe("invalid-note");
    expect(verdict(withField("displayName", "a\ud83d"))).toBe("invalid-display-name");
    expect(verdict(withField("chords", [{ symbol: "C\ud83d", voicing: v("x32010") }]))).toBe("invalid-symbol");
  });

  it.each([-1, 8, 1.5, "3", Number.NaN, Infinity, null, undefined])("カポ %s は invalid-capo", (capo) => {
    expect(verdict(withField("capo", capo))).toBe("invalid-capo");
  });

  it("コードが0件、または MAX_PROGRESSION_CHORDS を超えると invalid-chord-count", () => {
    expect(verdict(withField("chords", []))).toBe("invalid-chord-count");
    expect(verdict(withField("chords", chordsOf(MAX_PROGRESSION_CHORDS + 1)))).toBe("invalid-chord-count");
    expect(verdict(withField("chords", chordsOf(MAX_PROGRESSION_CHORDS)))).toBe("ok");
  });

  it.each(["H", "", " ", "C".repeat(MAX_SYMBOL_LENGTH + 1), "C\nm", "Cfoo", "C/"])(
    "読めない・長すぎる・制御文字入りの記号 %j は invalid-symbol",
    (symbol) => {
      expect(verdict(withField("chords", [{ symbol, voicing: v("x32010") }]))).toBe("invalid-symbol");
    },
  );

  it("構成音の欠けた押さえ方は invalid-voicing", () => {
    // C の構成音のうち E を含まない形
    expect(verdict(withField("chords", [{ symbol: "C", voicing: v("x3x01x") }]))).toBe("invalid-voicing");
    // G のコードに C の押さえ方
    expect(verdict(withField("chords", [{ symbol: "G", voicing: v("x32010") }]))).toBe("invalid-voicing");
  });

  it.each([
    ["フレットが16", [null, 3, 2, 0, 1, 16]],
    ["フレットが負", [null, 3, 2, 0, 1, -1]],
    ["フレットが小数", [null, 3, 2, 0, 1, 0.5]],
    ["弦が5本", [null, 3, 2, 0, 1]],
    ["弦が7本", [null, 3, 2, 0, 1, 0, 0]],
    ["文字列が混ざる", [null, 3, 2, 0, 1, "0"]],
    ["undefined が混ざる", [null, 3, 2, 0, 1, undefined]],
    ["NaN が混ざる", [null, 3, 2, 0, 1, Number.NaN]],
  ])("押さえ方 %s は invalid-voicing", (_name, voicing) => {
    expect(verdict(withField("chords", [{ symbol: "C", voicing }]))).toBe("invalid-voicing");
  });

  it("カポ付きで、鳴らす記号のまま作った押さえ方（形の記号に合わない）は落ちる", () => {
    // カポ3の Bb の押さえ方は G の形。Bb の形（x13331）で出すと、G の形としては不合格
    const asSounding = { ...validScore(), capo: 3, chords: [{ symbol: "Bb", voicing: v("x13331") }] };
    expect(verdict(asSounding)).toBe("invalid-voicing");
  });

  it("カポを変えると、同じ押さえ方の合否が変わる（形の記号で検証している）", () => {
    const chords = [{ symbol: "Bb", voicing: v("320003") }];
    expect(verdict({ ...validScore(), capo: 0, chords })).toBe("invalid-voicing");
    expect(verdict({ ...validScore(), capo: 3, chords })).toBe("ok");
  });
});

describe("CAPO_FRETS", () => {
  it("カポは 0（なし）から 7 まで", () => {
    expect(CAPO_FRETS).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("validateSharedScore: 性質", () => {
  it("どんな値を渡しても例外を投げない", () => {
    const hostile = (): unknown => {
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      return revoked.proxy;
    };
    const throwing = { get title(): string { throw new Error("読むと投げる"); } };
    const inputs: unknown[] = [hostile(), throwing, { ...validScore(), chords: [hostile()] }, { ...validScore(), chords: hostile() }];
    for (const input of inputs) expect(() => validateSharedScore(input)).not.toThrow();

    fc.assert(
      fc.property(fc.anything({ withBigInt: true, withNullPrototype: true, withObjectString: true }), (value) => {
        expect(() => validateSharedScore(value)).not.toThrow();
      }),
    );
    // 譜面に近い形の壊れた値でも投げない
    fc.assert(
      fc.property(
        fc.record({
          title: fc.anything(),
          note: fc.anything(),
          displayName: fc.anything(),
          capo: fc.anything(),
          chords: fc.array(fc.record({ symbol: fc.anything(), voicing: fc.anything() })),
        }),
        (value) => {
          expect(() => validateSharedScore(value)).not.toThrow();
        },
      ),
    );
  });

  it("generateVoicings で作った妥当な譜面（任意のコード・カポ・文字列）は常に通り、往復で値が変わらない", () => {
    // 制御文字・孤立サロゲートを含まない文字から作る。長さはコードポイント単位
    const text = (max: number, extra = "") =>
      fc.string({ unit: fc.constantFrom(...[..."あいうabc ｱ🎸𠮷", ...extra]), maxLength: max });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(chordSymbols, fc.nat()), { minLength: 1, maxLength: 6 }),
        fc.constantFrom(...CAPO_FRETS),
        text(MAX_TITLE_LENGTH).filter((s) => s.trim() !== ""),
        text(MAX_NOTE_LENGTH, "\n"),
        text(MAX_DISPLAY_NAME_LENGTH).filter((s) => s.trim() !== ""),
        (picks, capo, title, note, displayName) => {
          const chords = picks.map(([shapeSymbol, index]) => {
            // 画面は、鳴らす記号を下げた形の記号で押さえ方を作る。ここでは形の記号から鳴らす記号を作る
            const voicings = generateVoicings(chord(shapeSymbol));
            const sounding = lowerSymbol(shapeSymbol, -capo);
            expect(parseChord(sounding).ok).toBe(true);
            return { symbol: sounding, voicing: voicings[index % voicings.length]! };
          });
          const score = { title, note, displayName, capo, chords };
          expect(validateSharedScore(score)).toEqual({ ok: true, score });
        },
      ),
      { numRuns: 30 },
    );
  });

  it("通った結果は、常に上限・文字種の条件を満たす", () => {
    const codePoints = (s: string) => [...s].length;
    // 制御文字・サロゲート・区切り・双方向制御を含む全範囲の文字
    const anyText = (max: number) =>
      fc.oneof(
        fc.string({ unit: "binary", maxLength: max }),
        fc.string({ unit: fc.constantFrom(..."aあ \n\r\t\u2028\u202e🎸"), maxLength: max }),
      );
    fc.assert(
      fc.property(
        fc.record({
          title: anyText(60),
          note: anyText(220),
          displayName: fc.oneof(anyText(25), fc.constant(undefined)),
          capo: fc.integer({ min: -2, max: 9 }),
          chords: fc.array(fc.constantFrom({ symbol: "C", voicing: v("x32010") }, { symbol: "Am", voicing: v("x02210") }), { maxLength: 70 }),
        }),
        (input) => {
          const result = validateSharedScore(input);
          if (!result.ok) return;
          const { score } = result;
          expect(codePoints(score.title)).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
          expect(score.title.trim()).not.toBe("");
          expect(codePoints(score.note)).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
          expect(codePoints(score.displayName)).toBeLessThanOrEqual(MAX_DISPLAY_NAME_LENGTH);
          expect(score.displayName.trim()).not.toBe("");
          expect(/[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(score.title + score.displayName)).toBe(false);
          expect(/[\p{Cc}\p{Cs}]/u.test(score.note.replaceAll("\n", ""))).toBe(false);
          expect(CAPO_FRETS).toContain(score.capo);
          expect(score.chords.length).toBeGreaterThanOrEqual(1);
          expect(score.chords.length).toBeLessThanOrEqual(MAX_PROGRESSION_CHORDS);
        },
      ),
    );
  });
});

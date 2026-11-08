import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TITLE_LENGTH,
  validateSharedScore,
  type SharedChord,
  type SharedScoreFailure,
} from "@shirabe-chord/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "./auth-context.tsx";
import { isShareId } from "./route.ts";
import { TurnstileBox } from "./turnstile-box.tsx";

// 画面に出す文言は固定。サーバーの本文や例外の中身は、入力を含みうるので出さない。
const FAILURE_TEXT: Record<SharedScoreFailure, string> = {
  "invalid-title": `タイトルを確認してください（空にはできません。${MAX_TITLE_LENGTH}字まで。制御文字は使えません）`,
  "invalid-note": `ひと言を確認してください（${MAX_NOTE_LENGTH}字まで。改行以外の制御文字は使えません）`,
  "invalid-display-name": `表示名を確認してください（${MAX_DISPLAY_NAME_LENGTH}字まで。制御文字は使えません）`,
  "invalid-shape": "この進行は共有できません",
  "invalid-capo": "この進行は共有できません",
  "invalid-chord-count": "この進行は共有できません",
  "invalid-symbol": "この進行は共有できません",
  "invalid-voicing": "この進行は共有できません",
};
const GENERIC_FAILURE = "共有できませんでした。時間をおいて、もう一度お試しください";

type Problem = { readonly text: string; /** 共有した譜面の一覧への案内を付ける。 */ readonly mine?: true };

/** 共有の作成の応答を、画面の文言にする。`null` は呼び出し側が別に扱う（401）。 */
function problemOf(status: number): Problem | null {
  switch (status) {
    case 401:
      return null;
    case 400:
      return { text: "この内容では共有できません。入力を確かめてください" };
    case 403:
      return { text: "確認に失敗しました。もう一度お試しください" };
    case 409:
      return { text: "共有できる数の上限に達しています。古い共有を削除してください", mine: true };
    case 429:
      return { text: "しばらくしてからもう一度お試しください" };
    default:
      return { text: GENERIC_FAILURE };
  }
}

/**
 * 譜面を共有するダイアログ。ログイン前は案内だけを出す。`chords` は組み立て済みの各コード（組み立てに失敗しているときは `null`）。
 * 共有すると URL を知る人は誰でも見られるので、送る前にそれを書く（docs/adr/0035-share-by-unguessable-url-with-google-login.md）。
 */
export function ShareDialog(props: {
  chords: readonly SharedChord[] | null;
  capo: number;
  siteKey: string;
  onClose: () => void;
  onOpenMine: () => void;
}) {
  const { chords, capo } = props;
  const auth = useAuth();
  const panel = useRef<HTMLDivElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);

  /** 送信中に閉じると、作られた共有の URL を見られないまま上限だけ減る。送信中は閉じさせない。 */
  const onClose = () => {
    if (!sending) props.onClose();
  };
  useEffect(() => panel.current?.focus(), []);
  // 押していたボタンが消える（ログインの案内に切り替わる・共有できた）とき、フォーカスを見失わないようにする
  useEffect(() => {
    if (!auth.loggedIn) panel.current?.focus();
  }, [auth.loggedIn]);
  useEffect(() => {
    if (url !== null) urlInput.current?.focus();
  }, [url]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (chords === null || token === null || sending) return;
    const checked = validateSharedScore({ title, note, displayName, capo, chords });
    if (!checked.ok) {
      setProblem({ text: FAILURE_TEXT[checked.reason] });
      return;
    }
    setSending(true);
    setProblem(null);
    const used = token;
    setToken(null); // トークンは 1 回しか使えない
    try {
      const response = await auth.apiFetch("/api/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken: used, score: checked.score }),
      });
      if (response.status === 201) {
        const body: unknown = await response.json();
        const id = typeof body === "object" && body !== null ? (body as Record<string, unknown>).id : undefined;
        if (isShareId(id)) {
          setUrl(`${window.location.origin}/s/${id}`);
          return;
        }
        setProblem({ text: GENERIC_FAILURE });
      } else {
        setProblem(problemOf(response.status)); // 401 は、ログインの案内に切り替わる
      }
    } catch {
      setProblem({ text: GENERIC_FAILURE });
    } finally {
      setSending(false);
      setResetKey((key) => key + 1);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url!);
      setCopy("copied");
    } catch {
      setCopy("failed"); // クリップボードが無い環境（TypeError）も、書き込みの拒否もここに来る
    }
  };

  return (
    <div className="dialog-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" className="dialog" tabIndex={-1} ref={panel}>
        <h2 id="share-dialog-title">譜面を共有する</h2>
        {!auth.loggedIn ? (
          <>
            <p>共有には Google ログインが必要です</p>
            <button type="button" onClick={() => void auth.login("share")}>
              Google でログイン
            </button>
          </>
        ) : url !== null ? (
          <>
            <p role="status">共有しました。この URL を知っている人は誰でも、この譜面を見られます。</p>
            <label className="field">
              共有 URL
              <input type="text" readOnly ref={urlInput} value={url} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <button type="button" onClick={copyUrl}>
              URL をコピー
            </button>
            <p role="status">
              {copy === "copied" && "コピーしました"}
              {copy === "failed" && "コピーできませんでした"}
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="field">
              タイトル
              <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              ひと言（任意）
              <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <label className="field">
              表示名（任意）
              <input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <p className="field-hint">表示名を空にすると「匿名」と表示されます。</p>
            <p className="share-notice">共有すると、URL を知っている人は誰でもこの譜面を見られます。</p>
            {chords === null ? (
              <p>押さえ方を出せない進行は共有できません。進行を直してから、もう一度開いてください。</p>
            ) : (
              <TurnstileBox siteKey={props.siteKey} resetKey={resetKey} onToken={setToken} />
            )}
            {problem && (
              <div role="alert" className="problem">
                <p>{problem.text}</p>
                {problem.mine && (
                  <button type="button" onClick={props.onOpenMine}>
                    共有した譜面を開く
                  </button>
                )}
              </div>
            )}
            <button type="submit" disabled={chords === null || token === null || sending}>
              この内容で共有する
            </button>
          </form>
        )}
        <button type="button" disabled={sending} onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

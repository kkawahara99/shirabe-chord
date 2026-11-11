import { useEffect, useState, type MouseEvent } from "react";
import { useAuth } from "./auth-context.tsx";
import { GoogleMark } from "./google-mark.tsx";
import { isShareId } from "./route.ts";

/** 1 人が持てる共有の数。apps/api の `MAX_SHARES_PER_OWNER` と同じ（web から api は読めないので写している）。 */
const MAX_SHARES = 20;

type Share = { readonly id: string; readonly title: string; readonly createdAt: string; readonly chordCount: number };

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ok"; readonly shares: readonly Share[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** 応答は信用しない入力として、形を確かめてから使う。1 件でも合わなければ全体を失敗とする。 */
function readShares(value: unknown): Share[] | null {
  if (!isRecord(value) || !Array.isArray(value.shares)) return null;
  const shares: Share[] = [];
  for (const item of value.shares as unknown[]) {
    if (!isRecord(item)) return null;
    const { id, title, createdAt, chordCount } = item;
    if (!isShareId(id) || typeof title !== "string" || typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt))) return null;
    if (typeof chordCount !== "number" || !Number.isInteger(chordCount) || chordCount < 0) return null;
    shares.push({ id, title, createdAt, chordCount });
  }
  return shares;
}

/** 端末のローカル日付で「2026/11/07」の形にする。 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${two(date.getMonth() + 1)}/${two(date.getDate())}`;
}

type Removal = "idle" | "confirming" | "removing" | "failed";

/** 1 件分。削除は、画面の中の確認（`confirm` は使わない）を経てから呼ぶ。 */
function ShareItem(props: { share: Share; onOpen: (id: string) => void; onRemoved: (id: string) => void }) {
  const { share, onOpen, onRemoved } = props;
  const auth = useAuth();
  const [removal, setRemoval] = useState<Removal>("idle");
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);

  const open = (event: MouseEvent) => {
    event.preventDefault();
    onOpen(share.id);
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/s/${share.id}`);
      setCopy("copied");
    } catch {
      setCopy("failed"); // クリップボードが無い環境（TypeError）も、書き込みの拒否もここに来る
    }
  };

  const remove = async () => {
    if (removal === "removing") return;
    setRemoval("removing");
    try {
      const response = await auth.apiFetch(`/api/shares/${share.id}`, { method: "DELETE" });
      // 404 は、すでに無い（別の画面で消した）ので、一覧からも消す。401 は、ログインの案内に切り替わる
      if (response.status === 204 || response.status === 404) onRemoved(share.id);
      else setRemoval(response.status === 401 ? "idle" : "failed");
    } catch {
      setRemoval("failed");
    }
  };

  return (
    <li className="mine-item">
      <span className="mine-title">{share.title}</span>
      <span className="mine-meta">
        <span>{formatDate(share.createdAt)}</span> <span>{share.chordCount}コード</span>
      </span>
      <div className="mine-actions">
        <a href={`/s/${share.id}`} onClick={open}>
          開く
        </a>
        <button type="button" onClick={copyUrl}>
          URL をコピー
        </button>
        <button type="button" disabled={removal !== "idle"} onClick={() => setRemoval("confirming")}>
          削除
        </button>
      </div>
      <p role="status">
        {copy === "copied" && "コピーしました"}
        {copy === "failed" && "コピーできませんでした"}
      </p>
      {removal !== "idle" && (
        <div className="mine-confirm">
          <p>削除すると、この URL を開いても見られなくなります。</p>
          <button type="button" autoFocus disabled={removal === "removing"} onClick={() => void remove()}>
            削除する
          </button>
          <button type="button" disabled={removal === "removing"} onClick={() => setRemoval("idle")}>
            やめる
          </button>
          {removal === "failed" && <p role="alert" className="problem">削除できませんでした。時間をおいて、もう一度お試しください。</p>}
        </div>
      )}
    </li>
  );
}

/** 自分が共有した譜面の一覧。開く・URL のコピー・削除ができる。 */
export function MinePage(props: { onHome: () => void; onOpen: (id: string) => void }) {
  const auth = useAuth();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!auth.loggedIn) return;
    let cancelled = false;
    setState({ kind: "loading" });
    const load = async (): Promise<State> => {
      try {
        const response = await auth.apiFetch("/api/shares");
        if (!response.ok) return { kind: "error" };
        const shares = readShares(await response.json());
        return shares ? { kind: "ok", shares } : { kind: "error" };
      } catch {
        return { kind: "error" };
      }
    };
    void load().then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps -- ログイン状態が変わったときだけ取り直す

  const goHome = (event: MouseEvent) => {
    event.preventDefault();
    props.onHome();
  };
  const removed = (id: string) =>
    setState((current) => (current.kind === "ok" ? { kind: "ok", shares: current.shares.filter((share) => share.id !== id) } : current));

  return (
    <main className="page mine-view">
      <h2>共有した譜面</h2>
      {!auth.loggedIn ? (
        <>
          <p>共有した譜面を見るには、Google ログインが必要です。</p>
          <button type="button" onClick={() => void auth.login("mine")}>
            <GoogleMark />
            Google でログイン
          </button>
        </>
      ) : (
        <>
          {state.kind === "loading" && <p role="status">読み込み中</p>}
          {state.kind === "error" && <p role="alert">読み込めませんでした。時間をおいて、もう一度お試しください。</p>}
          {state.kind === "ok" && (
            <>
              <p>
                {state.shares.length} / {MAX_SHARES}
              </p>
              {state.shares.length === 0 ? (
                <p>まだ共有した譜面はありません</p>
              ) : (
                <ul className="mine-list">
                  {state.shares.map((share) => (
                    <ShareItem key={share.id} share={share} onOpen={props.onOpen} onRemoved={removed} />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      <a href="/" onClick={goHome}>
        トップへ戻る
      </a>
    </main>
  );
}

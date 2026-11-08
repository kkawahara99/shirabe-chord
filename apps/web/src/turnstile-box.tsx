import { useEffect, useRef, useState } from "react";
import { loadTurnstile, type TurnstileApi } from "./turnstile.ts";

/**
 * Turnstile のウィジェット。トークンを得たら `onToken(token)`、期限切れなら `onToken(null)`。
 * トークンは 1 回しか使えないので、使ったら `resetKey` を増やして取り直す。
 */
export function TurnstileBox(props: { siteKey: string; resetKey: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const onToken = useRef(props.onToken);
  onToken.current = props.onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled || !box.current) return;
        const id = api.render(box.current, {
          sitekey: props.siteKey,
          callback: (token) => {
            setFailed(false);
            onToken.current(token);
          },
          "expired-callback": () => onToken.current(null),
          "error-callback": () => {
            onToken.current(null);
            setFailed(true);
          },
        });
        widget.current = { api, id };
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      widget.current?.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [props.siteKey]);

  const { resetKey } = props;
  useEffect(() => {
    if (resetKey > 0) widget.current?.api.reset(widget.current.id);
  }, [resetKey]);

  return (
    <>
      <div ref={box} />
      {failed && <p role="alert">確認の部品を読み込めませんでした。時間をおいて、開き直してください</p>}
    </>
  );
}

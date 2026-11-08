import type { SoundingNote } from "@shirabe-chord/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPlayer, type AudioContextLike, type PlaybackState, type Player } from "./player.ts";

const audioSupported = () => typeof globalThis.AudioContext === "function";

/** 画面を開いただけでは呼ばない（鳴らす操作のときに初めて呼ばれる。自動再生の規制に合わせる）。 */
const createAudioContext = () => new globalThis.AudioContext() as unknown as AudioContextLike;

const IDLE: PlaybackState = { playing: false, active: null };

/** 画面から使う再生。タブが隠れたら止め、画面を閉じたら音声も閉じる。 */
export function usePlayback() {
  const playerRef = useRef<Player | null>(null);
  const [state, setState] = useState<PlaybackState>(IDLE);
  /** `AudioContext` が無い、または作れなかった。 */
  const [unavailable, setUnavailable] = useState(() => !audioSupported());

  const player = () => (playerRef.current ??= createPlayer({ createContext: createAudioContext, onChange: setState }));

  const stop = useCallback(() => playerRef.current?.stop(), []);

  const playChord = (notes: readonly SoundingNote[]) => {
    if (!player().playChord(notes)) setUnavailable(true);
  };
  const playProgression = (chords: readonly (readonly SoundingNote[])[], options: { tempo: number; loop: boolean }) => {
    if (!player().playProgression(chords, options)) setUnavailable(true);
  };

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) playerRef.current?.stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  return { state, unavailable, playChord, playProgression, stop };
}

import { useEffect, useRef, useState } from "react";
import type { PublicGame } from "../../shared/types";

type SoundSnapshot = {
  id: string;
  questionIndex: number;
  revision: number;
  opened: number;
  strikes: number;
  phase: PublicGame["phase"];
};

export function useGameSound(
  game: PublicGame | null,
  connected: boolean,
  requestError: string,
) {
  const context = useRef<AudioContext | null>(null);
  const previous = useRef<SoundSnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (context.current && context.current.state !== "closed")
        void context.current.close().catch(() => {});
    },
    [],
  );

  async function toggle() {
    setError("");
    if (enabled) {
      setEnabled(false);
      return;
    }
    setBusy(true);
    try {
      const Constructor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Constructor)
        throw new Error(
          "Этот браузер не поддерживает звуки табло. Игра продолжится без них.",
        );
      context.current ??= new Constructor();
      if (context.current.state !== "running") await context.current.resume();
      if (context.current.state !== "running")
        throw new Error(
          "Браузер пока не разрешил звук. Попробуйте нажать кнопку ещё раз.",
        );
      setEnabled(true);
    } catch (err) {
      setEnabled(false);
      setError(
        err instanceof Error
          ? err.message
          : "Звук недоступен. Игра продолжится без него.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!game || !connected || requestError) {
      previous.current = null;
      return;
    }
    const current: SoundSnapshot = {
      id: game.id,
      questionIndex: game.questionIndex,
      revision: game.revision,
      opened: game.answers.filter((answer) => answer.opened).length,
      strikes: game.strikes,
      phase: game.phase,
    };
    const last = previous.current;
    previous.current = current;
    if (
      !enabled ||
      !last ||
      last.id !== current.id ||
      last.questionIndex !== current.questionIndex ||
      current.revision <= last.revision ||
      last.phase === "lobby" ||
      current.phase === "lobby" ||
      current.phase === "finished" ||
      game.paused
    )
      return;
    const audio = context.current;
    if (!audio || audio.state !== "running") return;
    const revealed = current.opened > last.opened;
    const struck = current.strikes > last.strikes;
    if (!revealed && !struck) return;
    try {
      const time = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = revealed ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(revealed ? 523.25 : 164.81, time);
      if (revealed) oscillator.frequency.setValueAtTime(783.99, time + 0.1);
      else oscillator.frequency.exponentialRampToValueAtTime(110, time + 0.16);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(
        revealed ? 0.055 : 0.035,
        time + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.23);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.25);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch {
      setEnabled(false);
      setError(
        "Звук отключён: браузер не смог воспроизвести сигнал. Остальные функции работают.",
      );
    }
  }, [game, connected, requestError, enabled]);

  return { enabled, busy, error, toggle };
}

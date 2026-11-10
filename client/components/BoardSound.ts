import { useEffect, useRef, useState } from "react";
import type { Brand, PublicGame, SiteInfo } from "../../shared/types";
import { api } from "../lib";

type SoundKind = "correct" | "wrong" | "bank" | "repeat";
type SoundSnapshot = {
  id: string;
  questionIndex: number;
  revision: number;
  opened: number;
  strikes: number;
  phase: PublicGame["phase"];
  lastAction?: "strike" | "reveal" | "repeat" | null;
  lastActionEventId?: string;
  classicStage?: "duel" | "play" | "reverse" | "tiebreak" | "final";
};

/** Ignore reconnects, old revisions and other rounds; a single action can both
 * reveal the last answer and award the bank. */
export function soundEvents(last: SoundSnapshot | null, current: SoundSnapshot, paused: boolean): SoundKind[] {
  if (!last || last.id !== current.id || last.questionIndex !== current.questionIndex ||
      current.revision <= last.revision || last.phase === "lobby" ||
      current.phase === "lobby" || current.phase === "finished" || paused) return [];
  const newEvent = Boolean(current.lastActionEventId) && current.lastActionEventId !== last.lastActionEventId;
  // At the end of a round the board exposes all remaining answers at once;
  // only an actual reveal command should sound like a correct answer then.
  const revealed = current.opened > last.opened &&
    (current.phase !== "round-result" || (newEvent && current.lastAction === "reveal"));
  const awarded = current.phase === "round-result" && (last.phase === "playing" || last.phase === "steal") && last.classicStage !== "reverse";
  // Player joins and captain changes can advance a game's revision without
  // creating a game event. Only play an event-based strike once.
  const newStrikeEvent = current.lastAction === "strike" && newEvent;
  const struck = newStrikeEvent || current.strikes > last.strikes || (last.phase === "steal" && awarded && !revealed);
  const repeated = current.lastAction === "repeat" && newEvent;
  return [...(revealed ? ["correct" as const] : []), ...(struck ? ["wrong" as const] : []), ...(awarded ? ["bank" as const] : []), ...(repeated ? ["repeat" as const] : [])];
}

export function useGameSound(game: PublicGame | null, connected: boolean, requestError: string) {
  const context = useRef<AudioContext | null>(null);
  const previous = useRef<SoundSnapshot | null>(null);
  const buffers = useRef<Partial<Record<SoundKind, AudioBuffer>>>({});
  const playing = useRef(new Set<AudioScheduledSourceNode>());
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (context.current && context.current.state !== "closed") void context.current.close().catch(() => {});
  }, []);

  async function toggle() {
    setError("");
    if (enabled) {
      for (const source of playing.current) {
        try { source.stop(); } catch { /* source already ended */ }
      }
      playing.current.clear();
      setEnabled(false);
      return;
    }
    setBusy(true);
    try {
      const Constructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) throw new Error("Этот браузер не поддерживает звуки табло. Игра продолжится без них.");
      context.current ??= new Constructor();
      if (context.current.state !== "running") await context.current.resume();
      if (context.current.state !== "running") throw new Error("Браузер пока не разрешил звук. Попробуйте нажать кнопку ещё раз.");
      const audio = context.current;
      // Site settings are fetched afresh on each enable so an existing game can
      // use new sounds without changing its branding or resetting the round.
      let brand: Brand | undefined = game?.brand;
      try { brand = (await api<SiteInfo>("/site")).brand; } catch { /* use the game's snapshot */ }
      const sources: Array<[SoundKind, string | undefined]> = [
        ["correct", brand?.soundCorrectUrl], ["wrong", brand?.soundWrongUrl], ["bank", brand?.soundBankUrl],
        ["repeat", brand?.soundRepeatUrl],
      ];
      const next: Partial<Record<SoundKind, AudioBuffer>> = {};
      let failed = false;
      await Promise.all(sources.map(async ([kind, url]) => {
        if (!url || !/^\/media\/[a-f0-9-]+\.(mp3|wav|ogg)$/.test(url)) return;
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("audio download failed");
          next[kind] = await audio.decodeAudioData(await response.arrayBuffer());
        } catch { failed = true; }
      }));
      buffers.current = next;
      if (failed) setError("Не удалось загрузить один из звуков. Для него будет использован стандартный сигнал.");
      setEnabled(true);
    } catch (err) {
      setEnabled(false);
      setError(err instanceof Error ? err.message : "Звук недоступен. Игра продолжится без него.");
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!game || !connected || requestError) { previous.current = null; return; }
    const current: SoundSnapshot = {
      id: game.id, questionIndex: game.questionIndex, revision: game.revision,
      opened: game.answers.filter((answer) => answer.opened).length,
      strikes: game.strikes, phase: game.phase, lastAction: game.lastAction,
      lastActionEventId: game.lastActionEventId,
      classicStage: game.classic?.stage,
    };
    const last = previous.current;
    previous.current = current;
    if (!enabled) return;
    const events = soundEvents(last, current, game.paused);
    const audio = context.current;
    if (!events.length || !audio || audio.state !== "running") return;
    try {
      let offset = 0;
      events.forEach((kind) => {
        const time = audio.currentTime + offset;
        const buffer = buffers.current[kind];
        if (buffer) {
          const source = audio.createBufferSource();
          source.buffer = buffer;
          source.connect(audio.destination);
          playing.current.add(source);
          source.start(time);
          source.onended = () => { playing.current.delete(source); source.disconnect(); };
          offset += buffer.duration + 0.05;
          return;
        }
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = kind === "wrong" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(kind === "wrong" ? 164.81 : kind === "bank" ? 392 : kind === "repeat" ? 880 : 523.25, time);
        if (kind === "wrong") oscillator.frequency.exponentialRampToValueAtTime(110, time + 0.16);
        else oscillator.frequency.setValueAtTime(kind === "bank" ? 659.25 : kind === "repeat" ? 440 : 783.99, time + 0.1);
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(kind === "wrong" ? 0.035 : 0.055, time + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.23);
        oscillator.connect(gain); gain.connect(audio.destination);
        playing.current.add(oscillator);
        oscillator.start(time); oscillator.stop(time + 0.25);
        oscillator.onended = () => { playing.current.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        offset += 0.3;
      });
    } catch {
      setEnabled(false);
      setError("Звук отключён: браузер не смог воспроизвести сигнал. Остальные функции работают.");
    }
  }, [game, connected, requestError, enabled]);

  return { enabled, busy, error, toggle };
}

import { useEffect, useRef, useState } from "react";
import type { Brand, PublicGame, SiteInfo, SoundCue } from "../../shared/types";
import { api } from "../lib";

export type SoundKind =
  | "correct" | "wrong" | "bank" | "repeat"
  | "start" | "round" | "buzz" | "steal" | "timer" | "timeUp" | "finish" | "prize";

/** Every signal of the board, its setting in the site branding and its label. */
export const soundCatalog: Array<{ kind: SoundKind; key: keyof Brand & `sound${string}Url`; label: string; hint: string }> = [
  { kind: "correct", key: "soundCorrectUrl", label: "Правильный ответ", hint: "Открыт ответ на табло или в финале" },
  { kind: "wrong", key: "soundWrongUrl", label: "Ошибка", hint: "Промах команды или ответ, которого нет в опросе" },
  { kind: "bank", key: "soundBankUrl", label: "Банк присуждён", hint: "Раунд завершён, очки ушли команде" },
  { kind: "buzz", key: "soundBuzzUrl", label: "Красная кнопка", hint: "Команда первой нажала кнопку" },
  { kind: "start", key: "soundStartUrl", label: "Начало игры", hint: "Ведущий запустил игру" },
  { kind: "round", key: "soundRoundUrl", label: "Новый раунд", hint: "На табло появился следующий вопрос" },
  { kind: "steal", key: "soundStealUrl", label: "Перехват", hint: "Три ошибки: ход переходит соперникам" },
  { kind: "timer", key: "soundTimerUrl", label: "Старт таймера", hint: "Запущен отсчёт в большой игре" },
  { kind: "timeUp", key: "soundTimeUpUrl", label: "Время вышло", hint: "Закончился таймер финала или игры наоборот" },
  { kind: "repeat", key: "soundRepeatUrl", label: "Повтор ответа в финале", hint: "Второй игрок назвал ответ первого" },
  { kind: "finish", key: "soundFinishUrl", label: "Игра завершена", hint: "Финальный экран с победителями" },
  { kind: "prize", key: "soundPrizeUrl", label: "Суперприз", hint: "В большой игре набрана цель" },
];

type SoundSnapshot = {
  id: string;
  questionIndex: number;
  revision: number;
  opened: number;
  strikes: number;
  phase: PublicGame["phase"];
  lastAction?: SoundCue | null;
  lastActionEventId?: string;
  classicStage?: "duel" | "play" | "reverse" | "tiebreak" | "final";
};

const cueSounds: Partial<Record<SoundCue, SoundKind>> = {
  start: "start", round: "round", buzz: "buzz", steal: "steal", timer: "timer",
  finish: "finish", prize: "prize", repeat: "repeat",
};

/** Ignore reconnects, old revisions and other rounds; a single action can both
 * reveal the last answer and award the bank. */
export function soundEvents(last: SoundSnapshot | null, current: SoundSnapshot, paused: boolean): SoundKind[] {
  if (!last || last.id !== current.id || current.revision <= last.revision || paused) return [];
  // Player joins and captain changes can advance a game's revision without
  // creating a game event. Event-based signals play once per event.
  const newEvent = Boolean(current.lastActionEventId) && current.lastActionEventId !== last.lastActionEventId;
  const cue = newEvent && current.lastAction ? cueSounds[current.lastAction] : undefined;
  const cued = cue ? [cue] : [];
  if (last.questionIndex !== current.questionIndex || last.phase === "lobby" ||
      current.phase === "lobby" || current.phase === "finished") {
    // A new question, the start and the end of the game have no board diff to compare.
    return cued.filter((kind) => kind === "start" || kind === "round" || kind === "finish" || kind === "prize");
  }
  // At the end of a round the board exposes all remaining answers at once;
  // only an actual reveal command should sound like a correct answer then.
  const revealed = (current.opened > last.opened &&
    (current.phase !== "round-result" || (newEvent && current.lastAction === "reveal"))) ||
    (current.classicStage === "final" && newEvent && current.lastAction === "reveal");
  const awarded = current.phase === "round-result" && (last.phase === "playing" || last.phase === "steal") && last.classicStage !== "reverse";
  const newStrikeEvent = (current.lastAction === "strike" || current.lastAction === "steal") && newEvent;
  const struck = newStrikeEvent || current.strikes > last.strikes || (last.phase === "steal" && awarded && !revealed);
  return [...(revealed ? ["correct" as const] : []), ...(struck ? ["wrong" as const] : []), ...(awarded ? ["bank" as const] : []), ...cued];
}

type Tone = { wave: OscillatorType; gain: number; notes: Array<[frequency: number, at: number, length: number, glideTo?: number]> };
/** Built-in signals used until the organizer uploads their own files. */
const tones: Record<SoundKind, Tone> = {
  correct: { wave: "sine", gain: 0.055, notes: [[523.25, 0, 0.1], [783.99, 0.1, 0.15]] },
  wrong: { wave: "triangle", gain: 0.035, notes: [[164.81, 0, 0.25, 110]] },
  bank: { wave: "sine", gain: 0.055, notes: [[392, 0, 0.1], [659.25, 0.1, 0.15]] },
  repeat: { wave: "sine", gain: 0.055, notes: [[880, 0, 0.1], [440, 0.1, 0.15]] },
  start: { wave: "sine", gain: 0.05, notes: [[392, 0, 0.12], [523.25, 0.12, 0.12], [659.25, 0.24, 0.12], [783.99, 0.36, 0.3]] },
  round: { wave: "sine", gain: 0.05, notes: [[440, 0, 0.12], [587.33, 0.12, 0.22]] },
  buzz: { wave: "square", gain: 0.03, notes: [[220, 0, 0.45]] },
  steal: { wave: "triangle", gain: 0.045, notes: [[329.63, 0, 0.12], [261.63, 0.12, 0.12], [329.63, 0.24, 0.2]] },
  timer: { wave: "sine", gain: 0.05, notes: [[987.77, 0, 0.09], [987.77, 0.14, 0.09]] },
  timeUp: { wave: "square", gain: 0.03, notes: [[196, 0, 0.6, 147]] },
  finish: { wave: "sine", gain: 0.05, notes: [[523.25, 0, 0.14], [659.25, 0.14, 0.14], [783.99, 0.28, 0.14], [1046.5, 0.42, 0.4]] },
  prize: { wave: "sine", gain: 0.055, notes: [[523.25, 0, 0.1], [659.25, 0.1, 0.1], [783.99, 0.2, 0.1], [1046.5, 0.3, 0.1], [783.99, 0.4, 0.1], [1046.5, 0.5, 0.1], [1318.5, 0.6, 0.45]] },
};
const toneLength = (tone: Tone) => Math.max(...tone.notes.map(([, at, length]) => at + length));

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

  function play(events: SoundKind[]) {
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
          // Long jingles must not hold back the next signal for their whole length.
          offset += Math.min(buffer.duration, 1.5) + 0.05;
          return;
        }
        const tone = tones[kind];
        for (const [frequency, at, length, glideTo] of tone.notes) {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = tone.wave;
          oscillator.frequency.setValueAtTime(frequency, time + at);
          if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, time + at + length * 0.7);
          gain.gain.setValueAtTime(0.0001, time + at);
          gain.gain.exponentialRampToValueAtTime(tone.gain, time + at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + at + length);
          oscillator.connect(gain); gain.connect(audio.destination);
          playing.current.add(oscillator);
          oscillator.start(time + at); oscillator.stop(time + at + length + 0.02);
          oscillator.onended = () => { playing.current.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        }
        offset += toneLength(tone) + 0.07;
      });
    } catch {
      setEnabled(false);
      setError("Звук отключён: браузер не смог воспроизвести сигнал. Остальные функции работают.");
    }
  }
  const playRef = useRef(play);
  playRef.current = play;

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
      const next: Partial<Record<SoundKind, AudioBuffer>> = {};
      let failed = false;
      await Promise.all(soundCatalog.map(async ({ kind, key }) => {
        const url = brand?.[key];
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
    playRef.current(soundEvents(last, current, game.paused));
  }, [game, connected, requestError, enabled]);

  // The countdown ends on the board itself, without a host decision to react to.
  const final = game?.classic?.final;
  const reverse = game?.classic?.stage === "reverse" && game.phase === "playing" ? game.classic.reverse : null;
  const deadline = game?.paused ? null
    : final?.phase === "answering" ? final.deadlineAt
    : reverse?.deadlineAt ?? null;
  useEffect(() => {
    if (!enabled || !connected || deadline == null) return;
    const wait = deadline - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => playRef.current(["timeUp"]), wait);
    return () => window.clearTimeout(timer);
  }, [enabled, connected, deadline]);

  return { enabled, busy, error, toggle };
}

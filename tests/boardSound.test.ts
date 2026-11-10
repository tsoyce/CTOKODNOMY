import { describe, expect, test } from "vitest";
import { soundEvents } from "../client/components/BoardSound";

describe("sound events on the public board", () => {
  const before = { id: "game", questionIndex: 0, revision: 5, opened: 2, strikes: 1, phase: "playing" as const };
  test("detects answers, mistakes and a bank awarded with the last answer", () => {
    expect(soundEvents(before, { ...before, revision: 6, opened: 3 }, false)).toEqual(["correct"]);
    expect(soundEvents(before, { ...before, revision: 6, strikes: 2 }, false)).toEqual(["wrong"]);
    expect(soundEvents(before, { ...before, revision: 6, opened: 3, phase: "round-result", lastAction: "reveal", lastActionEventId: "reveal-1" }, false)).toEqual(["correct", "bank"]);
    expect(soundEvents({ ...before, phase: "steal" }, { ...before, revision: 6, phase: "round-result" }, false)).toEqual(["wrong", "bank"]);
    expect(soundEvents({ ...before, classicStage: "duel" }, { ...before, revision: 6, classicStage: "duel", lastAction: "strike", lastActionEventId: "strike-1" }, false)).toEqual(["wrong"]);
    expect(soundEvents({ ...before, classicStage: "reverse" }, { ...before, revision: 6, classicStage: "reverse", phase: "round-result", lastAction: "strike", lastActionEventId: "strike-1" }, false)).toEqual(["wrong"]);
  });
  test("plays each duel strike once even when an unrelated update advances the revision", () => {
    const previous = { ...before, classicStage: "duel" as const, lastAction: "strike" as const, lastActionEventId: "strike-1" };
    expect(soundEvents(previous, { ...previous, revision: 6 }, false)).toEqual([]);
    expect(soundEvents(previous, { ...previous, revision: 6, lastActionEventId: "strike-2" }, false)).toEqual(["wrong"]);
  });
  test("signals repeated final answers once per event", () => {
    const final = { ...before, classicStage: "final" as const };
    const repeat = { ...final, revision: 6, lastAction: "repeat" as const, lastActionEventId: "repeat-1" };
    expect(soundEvents(final, repeat, false)).toEqual(["repeat"]);
    expect(soundEvents(repeat, { ...repeat, revision: 7 }, false)).toEqual([]);
    expect(soundEvents(repeat, { ...repeat, revision: 7, lastActionEventId: "repeat-2" }, false)).toEqual(["repeat"]);
  });
  test("does not play a correct-answer signal for a mass reveal after a failed steal", () => {
    const steal = { ...before, phase: "steal" as const };
    expect(soundEvents(steal, { ...steal, revision: 6, opened: 6, phase: "round-result", lastAction: "strike", lastActionEventId: "strike-1" }, false)).toEqual(["wrong", "bank"]);
  });
  test("does not replay stale, cross-round, paused or initial state", () => {
    expect(soundEvents(null, before, false)).toEqual([]);
    expect(soundEvents(before, { ...before, opened: 3 }, false)).toEqual([]);
    expect(soundEvents(before, { ...before, revision: 6, questionIndex: 1, opened: 3 }, false)).toEqual([]);
    expect(soundEvents(before, { ...before, revision: 6, opened: 3 }, true)).toEqual([]);
  });
});

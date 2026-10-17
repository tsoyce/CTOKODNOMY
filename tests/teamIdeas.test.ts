import { describe, expect, test } from "vitest";
import type { Suggestion } from "../shared/types";
import { filterTeamIdeas, groupTeamIdeas, sortTeamIdeas } from "../shared/teamIdeas";

function suggestion(id: string, text: string, authorName: string, createdAt: string): Suggestion {
  return { id, text, authorName, createdAt, participantId: authorName, teamId: "team" };
}

describe("team ideas", () => {
  test("groups only case and whitespace variants and preserves all original messages", () => {
    const ideas = [
      suggestion("1", "  Наш\n ответ  ", "Анна", "2026-10-17T10:00:00Z"),
      suggestion("2", "НАШ ответ", "Борис", "2026-10-17T10:01:00Z"),
      suggestion("3", "наш   ответ", "Анна", "2026-10-17T10:02:00Z"),
      suggestion("4", "всё", "Анна", "2026-10-17T10:03:00Z"),
      suggestion("5", "все", "Анна", "2026-10-17T10:04:00Z"),
      suggestion("6", "Общение", "Анна", "2026-10-17T10:05:00Z"),
      suggestion("7", "Разговор", "Анна", "2026-10-17T10:06:00Z"),
    ];
    const groups = groupTeamIdeas(ideas);
    expect(groups).toHaveLength(5);
    const combined = groups.find((group) => group.key === "наш ответ")!;
    expect(combined.latest).toBe(ideas[2]);
    expect(combined.suggestions).toEqual([ideas[2], ideas[1], ideas[0]]);
    expect(combined.authorNames).toEqual(["Анна", "Борис"]);
    expect(groups.flatMap((group) => group.suggestions).map((item) => item.id).sort()).toEqual(ideas.map((item) => item.id));
    expect(ideas[0].text).toBe("  Наш\n ответ  ");
  });

  test("searches original text and author names without removing other originals in a match", () => {
    const groups = groupTeamIdeas([
      suggestion("1", "Общение", "Анна Иванова", "2026-10-17T10:00:00Z"),
      suggestion("2", "общение", "Борис", "2026-10-17T10:01:00Z"),
      suggestion("3", "Учёба", "Вера", "2026-10-17T10:02:00Z"),
    ]);
    expect(filterTeamIdeas(groups, "  АННА   ИВАНОВА  ")[0].suggestions).toHaveLength(2);
    expect(filterTeamIdeas(groups, "ОБЩЕ")[0].latest.id).toBe("2");
    expect(filterTeamIdeas(groups, "учеба")).toEqual([]);
    expect(filterTeamIdeas(groups, " ")).toEqual(groups);
  });

  test("sorts by latest message or message frequency, including repetitions by the same person", () => {
    const groups = groupTeamIdeas([
      suggestion("1", "Старый", "Анна", "2026-10-17T10:00:00Z"),
      suggestion("2", "СТАРЫЙ", "Анна", "2026-10-17T10:01:00Z"),
      suggestion("3", "Новый", "Борис", "2026-10-17T10:02:00Z"),
      suggestion("4", "Еще идея", "Вера", "2026-10-17T10:03:00Z"),
    ]);
    expect(sortTeamIdeas(groups, "newest").map((group) => group.latest.id)).toEqual(["4", "3", "2"]);
    expect(sortTeamIdeas(groups, "frequent").map((group) => group.latest.id)).toEqual(["2", "4", "3"]);
    expect(groups.map((group) => group.latest.id)).toEqual(["4", "3", "2"]);
  });
});

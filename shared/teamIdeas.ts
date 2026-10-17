import type { Suggestion } from "./types";

export interface TeamIdeaGroup {
  key: string;
  latest: Suggestion;
  suggestions: Suggestion[];
  authorNames: string[];
}

export type TeamIdeaOrder = "newest" | "frequent";

function ideaKey(text: string) {
  return text.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

function timestamp(suggestion: Suggestion) {
  const value = Date.parse(suggestion.createdAt);
  return Number.isFinite(value) ? value : 0;
}

/** Group spelling-only duplicates while retaining every original message. */
export function groupTeamIdeas(suggestions: readonly Suggestion[]): TeamIdeaGroup[] {
  const groups = new Map<string, TeamIdeaGroup>();
  const newestFirst = [...suggestions].reverse().sort((a, b) => timestamp(b) - timestamp(a));
  for (const suggestion of newestFirst) {
    const key = ideaKey(suggestion.text);
    const group = groups.get(key);
    if (group) {
      group.suggestions.push(suggestion);
      if (!group.authorNames.includes(suggestion.authorName)) {
        group.authorNames.push(suggestion.authorName);
      }
    } else {
      groups.set(key, {
        key,
        latest: suggestion,
        suggestions: [suggestion],
        authorNames: [suggestion.authorName],
      });
    }
  }
  return [...groups.values()];
}

export function filterTeamIdeas(groups: readonly TeamIdeaGroup[], search: string): TeamIdeaGroup[] {
  const query = ideaKey(search);
  return groups.filter((group) => !query || group.suggestions.some((suggestion) =>
    ideaKey(suggestion.text).includes(query) || ideaKey(suggestion.authorName).includes(query),
  ));
}

/** Frequency counts messages; it does not represent votes or unique people. */
export function sortTeamIdeas(groups: readonly TeamIdeaGroup[], order: TeamIdeaOrder): TeamIdeaGroup[] {
  return [...groups].sort((a, b) =>
    (order === "frequent" ? b.suggestions.length - a.suggestions.length : 0) ||
    timestamp(b.latest) - timestamp(a.latest),
  );
}

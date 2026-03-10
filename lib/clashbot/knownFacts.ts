// lib/clashbot/knownFacts.ts

export type KnownFactOverride = {
  id: string;
  keywordsAll?: string[];
  keywordsAny?: string[];
  contradictsClaim: boolean;
  label?: string;
  reason: string;
  sourceLabel?: string;
  sourceUrl?: string;
};

function normalize(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesPhrase(text: string, phrase: string) {
  return text.includes(normalize(phrase));
}

export const KNOWN_FACT_OVERRIDES: KnownFactOverride[] = [
  {
    id: "earth-flat",
    keywordsAll: ["earth", "flat"],
    contradictsClaim: true,
    label: "Known science",
    reason:
      "The Earth is not flat. Multiple lines of evidence, including satellite imagery and physics, contradict that claim.",
    sourceLabel: "NASA Earth science",
    sourceUrl: "https://earthobservatory.nasa.gov/",
  },
  {
    id: "sun-smaller-than-moon",
    keywordsAll: ["sun", "smaller", "moon"],
    contradictsClaim: true,
    label: "Known astronomy",
    reason:
      "The sun is far larger than the moon. It only appears similar in size from Earth because it is much farther away.",
    sourceLabel: "NASA solar system basics",
    sourceUrl: "https://solarsystem.nasa.gov/",
  },
  {
    id: "tom-brady-patriots-2026",
    keywordsAll: ["tom", "brady", "patriots", "2026"],
    contradictsClaim: true,
    label: "Known sports fact",
    reason:
      "Tom Brady retired from the NFL, so a claim that he plays for the Patriots in 2026 is outdated or false.",
    sourceLabel: "NFL / retirement coverage",
    sourceUrl: "https://www.nfl.com/",
  },
];

export function findKnownFactOverride(claimText: string): KnownFactOverride | null {
  const text = normalize(claimText);

  for (const rule of KNOWN_FACT_OVERRIDES) {
    const allOk =
      !rule.keywordsAll || rule.keywordsAll.every((kw) => includesPhrase(text, kw));

    const anyOk =
      !rule.keywordsAny || rule.keywordsAny.some((kw) => includesPhrase(text, kw));

    if (allOk && anyOk) {
      return rule;
    }
  }

  return null;
}
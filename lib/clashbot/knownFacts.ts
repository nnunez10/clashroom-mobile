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
  // ---------------------------------------------------------------------------
  // Basic arithmetic
  // normalize() strips "+" and "=" to spaces, so "2+2=4", "2 + 2 = 4",
  // and "2+2 = 4" all collapse to the phrase "2 2 4". The phrase check is
  // specific enough that incidental matches (e.g. "2 teams, 2 goals, 4-0") are
  // prevented by requiring all three tokens to be adjacent in sequence.
  // ---------------------------------------------------------------------------
  {
    id: "math-2plus2-equals-4",
    keywordsAll: ["2 2 4"],
    contradictsClaim: false,
    label: "Basic arithmetic",
    reason: "2 + 2 = 4 is a basic arithmetic fact.",
    sourceLabel: "Mathematics",
  },
  {
    id: "math-2plus2-equals-5",
    keywordsAll: ["2 2 5"],
    contradictsClaim: true,
    label: "Basic arithmetic",
    reason: "2 + 2 = 4, not 5. This is a basic arithmetic error.",
    sourceLabel: "Mathematics",
  },
  // ---------------------------------------------------------------------------
  // Earth shape
  // ---------------------------------------------------------------------------
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
    // "the earth is round" → normalized: "the earth is round"
    // Phrase match prevents matching "the flat earth is not round".
    id: "earth-round",
    keywordsAll: ["earth is round"],
    contradictsClaim: false,
    label: "Known science",
    reason:
      "The Earth is roughly spherical in shape, confirmed by satellite imagery and physics.",
    sourceLabel: "NASA Earth science",
    sourceUrl: "https://earthobservatory.nasa.gov/",
  },
  {
    id: "earth-spherical",
    keywordsAll: ["earth", "spherical"],
    contradictsClaim: false,
    label: "Known science",
    reason:
      "The Earth is an oblate spheroid — roughly spherical. This is confirmed by satellite imagery.",
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
  // ---------------------------------------------------------------------------
  // Well-known scientific / historical consensus
  // ---------------------------------------------------------------------------
  {
    id: "vaccines-cause-autism",
    keywordsAll: ["vaccine", "autism"],
    contradictsClaim: true,
    label: "Scientific consensus",
    reason:
      "Multiple large-scale studies involving millions of children have found no link between vaccines and autism. The original 1998 Wakefield study that sparked the claim was retracted due to fraud.",
    sourceLabel: "CDC / WHO immunization safety",
    sourceUrl: "https://www.cdc.gov/vaccinesafety/concerns/autism.html",
  },
  {
    id: "moon-landing-hoax",
    keywordsAll: ["moon"],
    keywordsAny: ["fake", "faked", "hoax", "staged", "never happened", "didn t happen", "not real", "conspiracy"],
    contradictsClaim: true,
    label: "Historical fact",
    reason:
      "NASA's Apollo program successfully landed astronauts on the Moon six times between 1969 and 1972. Independent agencies worldwide — including the Soviet Union, the United States' Cold War adversary — tracked the missions in real time and confirmed them.",
    sourceLabel: "NASA Apollo program",
    sourceUrl: "https://www.nasa.gov/mission/apollo-11/",
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
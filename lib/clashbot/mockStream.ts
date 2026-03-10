export type TranscriptTick = {
  text: string;
  ts: number;
};

const LINES = [
  "Gas prices are the highest they’ve ever been.",
  "The Earth is flat. Look it up.",
  "Inflation is down this quarter compared to last year.",
  "Vaccines cause autism.",
  "The Lakers are the best team in NBA history.",
  "Crime is up everywhere.",
  "Immigration is at record highs.",
  "That clip was edited, the context is missing.",
  "This policy would save billions.",
  "No one can afford groceries anymore.",
];

export function startMockTranscriptStream(
  onTick: (tick: TranscriptTick) => void
) {
  let i = 0;

  const id = setInterval(() => {
    const text = LINES[i % LINES.length];
    onTick({ text, ts: Date.now() });
    i += 1;
  }, 1200);

  return () => clearInterval(id);
}
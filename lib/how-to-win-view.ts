// Client-safe reader for the brief stored in battlecards.how_to_win (JSON text).

export type HowToWin = { headline: string; say_this: string[]; watch_out: string[]; generated_at: string };

export function parseHowToWin(text: string | null | undefined): HowToWin | null {
  if (!text) return null;
  try {
    const b = JSON.parse(text) as HowToWin;
    return b.headline && Array.isArray(b.say_this) ? b : null;
  } catch {
    return null;
  }
}

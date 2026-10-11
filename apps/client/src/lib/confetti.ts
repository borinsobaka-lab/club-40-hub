import confetti from "canvas-confetti";

/** Салют при завершении анкеты. */
export function fireConfetti() {
  const fire = (opts: confetti.Options) =>
    confetti({ particleCount: 80, spread: 70, startVelocity: 45, ...opts });
  fire({ origin: { x: 0.2, y: 0.7 }, angle: 60 });
  fire({ origin: { x: 0.8, y: 0.7 }, angle: 120 });
  setTimeout(() => fire({ origin: { x: 0.5, y: 0.6 }, spread: 100 }), 200);
}

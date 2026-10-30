import canvasConfetti from "canvas-confetti"

export function confetti(origin: Element): void {
  const rect = origin.getBoundingClientRect()
  canvasConfetti({
    origin: {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    },
    disableForReducedMotion: true,
  })
}

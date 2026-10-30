const COLORS = [
  "#a2dd60",
  "#ee65a9",
  "#6092dd",
  "#f3c548",
  "#46ec99",
  "#f03e47",
  "#7b4df7",
  "#3ff1bc",
]

type Origin = Element | { x: number; y: number }

function originPoint(origin: Origin): { x: number; y: number } {
  if (!(origin instanceof Element)) return origin
  const rect = origin.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function confetti(origin: Origin, count = 42): void {
  if (typeof document === "undefined") return
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const { x, y } = originPoint(origin)
  const layer = document.createElement("div")
  layer.setAttribute("aria-hidden", "true")
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2147483647"

  const animations = Array.from({ length: count }, (_, index) => {
    const piece = document.createElement("span")
    const size = between(5, 10)
    const round = index % 3 === 0
    piece.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${size}px;height:${round ? size : size * 0.5}px;background:${COLORS[index % COLORS.length]};border-radius:${round ? "50%" : "1px"};will-change:transform,opacity`
    layer.append(piece)

    const angle = between(-Math.PI * 0.95, -Math.PI * 0.05)
    const speed = between(60, 190)
    const dx = Math.cos(angle) * speed
    const peak = Math.sin(angle) * speed
    const fall = between(40, 140)
    const spin = between(-540, 540)

    return piece.animate(
      [
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${dx * 0.7}px, ${peak}px) rotate(${spin * 0.5}deg)`,
          opacity: 1,
          offset: 0.4,
        },
        {
          transform: `translate(${dx}px, ${fall}px) rotate(${spin}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: between(750, 1250),
        easing: "cubic-bezier(0.2, 0.7, 0.4, 1)",
        fill: "forwards",
      },
    ).finished
  })

  document.body.append(layer)
  Promise.allSettled(animations).then(() => layer.remove())
}

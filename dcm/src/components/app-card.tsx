import { useState } from "react"
import "./app-card.css"

export function starLabel(stars: number): string {
  if (stars >= 1000) return `${(stars / 1000).toFixed(1)}k`
  return String(stars)
}

function wiresLabel(wires: number): string {
  return `wires to ${wires} App${wires === 1 ? "" : "s"}`
}

export interface AppCardProps {
  name: string
  description: string
  icon?: string
  stars?: number
  repoUrl?: string
  detailsHref?: string
  wires?: number
  badge?: string
  selected: boolean
  unsupported?: boolean
  onSelect: () => void
}

function AppIcon({ name, icon }: { name: string; icon?: string }) {
  const [broken, setBroken] = useState(false)
  const failed = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setBroken(true)
  }

  return (
    <span className="appcard-ico">
      {icon && !broken ? (
        <img
          ref={failed}
          src={icon}
          alt=""
          width={22}
          height={22}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        name.charAt(0)
      )}
    </span>
  )
}

export function AppCard({
  name,
  description,
  icon,
  stars,
  repoUrl,
  detailsHref,
  wires,
  badge,
  selected,
  unsupported = false,
  onSelect,
}: AppCardProps) {
  const select = () => {
    if (!unsupported) onSelect()
  }
  const starTitle = stars
    ? `${stars.toLocaleString("en")} stars on GitHub`
    : "GitHub"

  return (
    <div
      className="appcard"
      data-selected={selected && !unsupported}
      data-unsupported={unsupported}
    >
      <button
        type="button"
        className="appcard-main"
        aria-pressed={selected && !unsupported}
        aria-disabled={unsupported}
        onClick={select}
      >
        <span className="appcard-title">
          <AppIcon name={name} icon={icon} />
          <b>{name}</b>
        </span>
        <span className="appcard-desc">{description}</span>
      </button>
      <div className="appcard-foot">
        <span className="appcard-meta">
          {badge && <span className="appcard-badge">{badge}</span>}
          {wires ? wiresLabel(wires) : null}
        </span>
        {detailsHref && (
          <a
            className="appcard-details"
            href={detailsHref}
            aria-label={`${name} details`}
          >
            details →
          </a>
        )}
      </div>
      {repoUrl && (
        <a
          className="appcard-stars"
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={starTitle}
          aria-label={`${name}: ${starTitle}`}
        >
          <span className="star" aria-hidden="true">
            ★
          </span>
          {stars ? starLabel(stars) : "GitHub"}
        </a>
      )}
    </div>
  )
}

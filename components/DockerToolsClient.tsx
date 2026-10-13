"use client"

import DiscoveryPanel from "@/components/discovery-panel"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import ToolGrid from "@/components/ToolGrid"
import { useSelection } from "@/hooks/use-selection"
import { type Catalog, canGenerateYaml } from "@/lib/catalog"
import { buildSelfHostLink } from "@/lib/selfhost"
import { decodeShareUrl } from "@/lib/url-utils"
import { cn } from "@/lib/utils"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

interface DockerToolsClientProps {
  catalog: Catalog
}

const ALL = "All"
const RECIPES_COLLAPSED = 8

export default function DockerToolsClient({ catalog }: DockerToolsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const processedShareRef = useRef(false)
  const selection = useSelection()
  const [category, setCategory] = useState(ALL)
  const [showAllRecipes, setShowAllRecipes] = useState(false)

  const shareParam = searchParams.get("share")

  useEffect(() => {
    if (!shareParam || processedShareRef.current) return
    processedShareRef.current = true
    selection.set(decodeShareUrl(shareParam))
    router.push("/")
  }, [shareParam, selection.set, router])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of catalog.entries) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b))
  }, [catalog])

  const visible = useMemo(() => {
    if (category === ALL) return catalog.entries
    return catalog.entries.filter((entry) => entry.category === category)
  }, [catalog, category])

  const recipes = showAllRecipes
    ? catalog.recipes
    : catalog.recipes.slice(0, RECIPES_COLLAPSED)

  const toggle = (id: string) => {
    const entry = catalog.entries.find((item) => item.id === id)
    if (entry?.isUnsupported) return
    selection.toggle(id)
  }

  const selected = shareParam ? decodeShareUrl(shareParam) : selection.ids

  return (
    <div className="container pb-8">
      <section className="py-10">
        <h1 className="font-bold text-3xl text-ink md:text-4xl">
          <span className="text-pink">$</span> docker compose maker
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Pick your apps, get a docker-compose.yaml.{" "}
          <span className="text-ink">Rather not manage YAML?</span>{" "}
          <a
            href={buildSelfHostLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink hover:underline"
          >
            self-host
          </a>{" "}
          installs and wires these for you.
        </p>
      </section>

      <SettingsPanel />
      <DiscoveryPanel />

      <FloatingBar
        catalog={catalog}
        ids={selected}
        onToggle={toggle}
        onClear={selection.clear}
      />

      {catalog.recipes.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 font-bold text-gold text-sm uppercase tracking-wider">
            Recipes
          </h2>
          <p className="mb-3 text-muted-foreground text-xs">
            Ready-made stacks. Select one to add every app in it.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recipes.map((recipe) => {
              const isSelected = selected.includes(recipe.id)
              const yamlCount = recipe.entryIds.filter((id) => {
                const entry = catalog.entries.find((item) => item.id === id)
                return entry && canGenerateYaml(entry)
              }).length
              return (
                <button
                  key={recipe.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selection.toggle(recipe.id)}
                  className={cn(
                    "card-top hover:-translate-x-0.5 hover:-translate-y-0.5 border border-gold/50 bg-panel p-4 pt-5 text-left shadow-sm transition-all hover:shadow-md",
                    isSelected && "border-pink bg-secondary",
                  )}
                >
                  <span className="font-bold text-gold">{recipe.name}</span>
                  <span className="mt-1 line-clamp-2 block text-muted-foreground text-xs">
                    {recipe.description}
                  </span>
                  <span className="mt-3 block text-[11px] text-dim">
                    {recipe.apps.length} apps · {yamlCount} with YAML
                  </span>
                </button>
              )
            })}
          </div>
          {catalog.recipes.length > RECIPES_COLLAPSED && (
            <button
              type="button"
              onClick={() => setShowAllRecipes(!showAllRecipes)}
              className="mt-3 text-gold text-xs hover:underline"
            >
              {showAllRecipes
                ? "Show fewer recipes"
                : `Show all ${catalog.recipes.length} recipes`}
            </button>
          )}
        </section>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {[[ALL, catalog.entries.length] as const, ...categories].map(
          ([name, count]) => (
            <button
              key={name}
              type="button"
              onClick={() => setCategory(name)}
              className={cn(
                "border px-2 py-1 text-xs transition-colors",
                category === name
                  ? "border-pink bg-pink text-bg"
                  : "border-line bg-panel text-muted-foreground hover:border-pink hover:text-pink",
              )}
            >
              {name} <span className="opacity-60">{count}</span>
            </button>
          ),
        )}
      </div>

      <ToolGrid entries={visible} selected={selected} onToggle={toggle} />
    </div>
  )
}

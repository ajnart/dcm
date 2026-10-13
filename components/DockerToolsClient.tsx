"use client"

import ToolGrid from "@/components/ToolGrid"
import DiscoveryPanel from "@/components/discovery-panel"
import FloatingBar from "@/components/floating-bar"
import SettingsPanel from "@/components/settings-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useSelection } from "@/hooks/use-selection"
import { type Catalog, canGenerateYaml } from "@/lib/catalog"
import { buildSelfHostLink } from "@/lib/selfhost"
import { decodeShareUrl } from "@/lib/url-utils"
import { cn } from "@/lib/utils"
import { Palette } from "lucide-react"
import Link from "next/link"
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
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl">Docker Compose Maker</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Rather not manage YAML?{" "}
            <a
              href={buildSelfHostLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary hover:underline"
            >
              self-host
            </a>{" "}
            installs and wires these for you.
          </p>
        </div>
        <Button asChild className="flex items-center gap-2">
          <Link prefetch={false} href="/templates">
            <Palette size={16} />
            Template Gallery
          </Link>
        </Button>
      </div>

      <div className="[animation-delay:300ms] motion-safe:animate-slide-down">
        <SettingsPanel />
      </div>

      <div className="[animation-delay:450ms] motion-safe:animate-slide-down">
        <DiscoveryPanel />
      </div>

      <FloatingBar
        catalog={catalog}
        ids={selected}
        onToggle={toggle}
        onClear={selection.clear}
      />

      {catalog.recipes.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 font-semibold text-xl">Recipes</h2>
          <p className="mb-3 text-muted-foreground text-sm">
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
                <Card
                  key={recipe.id}
                  className={cn(
                    "group relative cursor-pointer select-none overflow-hidden rounded-sm transition-all hover:shadow-md",
                    isSelected
                      ? "bg-secondary"
                      : "hover:border-muted-foreground/20",
                    "motion-safe:hover:scale-105",
                  )}
                  onClick={() => selection.toggle(recipe.id)}
                >
                  <div
                    className={cn(
                      "h-1 w-full transition-colors duration-300",
                      isSelected
                        ? "bg-primary"
                        : "bg-transparent group-hover:bg-primary/30",
                    )}
                  />
                  <CardContent className="p-4">
                    <h3 className="font-mono font-semibold tracking-tight">
                      {recipe.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                      {recipe.description}
                    </p>
                    <p className="mt-3 text-muted-foreground text-xs">
                      {recipe.apps.length} apps · {yamlCount} with YAML
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {catalog.recipes.length > RECIPES_COLLAPSED && (
            <Button
              variant="link"
              className="mt-2 h-auto p-0"
              onClick={() => setShowAllRecipes(!showAllRecipes)}
            >
              {showAllRecipes
                ? "Show fewer recipes"
                : `Show all ${catalog.recipes.length} recipes`}
            </Button>
          )}
        </section>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {[[ALL, catalog.entries.length] as const, ...categories].map(
          ([name, count]) => (
            <Button
              key={name}
              size="sm"
              variant={category === name ? "default" : "outline"}
              onClick={() => setCategory(name)}
            >
              {name} <span className="opacity-60">{count}</span>
            </Button>
          ),
        )}
      </div>

      <ToolGrid entries={visible} selected={selected} onToggle={toggle} />
    </>
  )
}

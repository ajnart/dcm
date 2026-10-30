import { TemplateCard } from "@/components/template-card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CatalogEntry } from "@/lib/catalog"
import type { Template } from "@/lib/templates"
import { Search } from "lucide-react"
import { useMemo, useState } from "react"

interface TemplateGalleryProps {
  templates: Template[]
  allTools: CatalogEntry[]
  onSelectTemplate: (tools: CatalogEntry[], template: Template) => void
  onUnselectTemplate?: (toolIds: string[], templateId: string) => void
  selectedTools: CatalogEntry[]
  selectedTemplateIds?: string[]
}

export function TemplateGallery({
  templates,
  allTools,
  onSelectTemplate,
  onUnselectTemplate,
  selectedTools,
  selectedTemplateIds = [],
}: TemplateGalleryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")

  // Get all unique categories from templates
  const categories = useMemo(() => {
    const categorySet = new Set<string>(
      templates.map((template) => template.category),
    )
    return ["all", ...Array.from(categorySet)]
  }, [templates])

  const activeCategory = categories.includes(selectedCategory)
    ? selectedCategory
    : "all"

  // Filter templates by search query and category
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesSearch =
        searchQuery === "" ||
        template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesCategory =
        activeCategory === "all" || template.category === activeCategory

      return matchesSearch && matchesCategory
    })
  }, [templates, searchQuery, activeCategory])

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-2">
        <h2 className="font-bold text-2xl">Template Gallery</h2>
        <p className="text-muted-foreground">
          Choose from predefined templates to quickly set up common Docker
          stacks
        </p>
      </div>

      <div className="space-y-6">
        <div className="relative max-w-md">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Tabs value={activeCategory} onValueChange={setSelectedCategory}>
          <TabsList className="mb-6">
            {categories.map((category) => (
              <TabsTrigger
                key={category}
                value={category}
                className="capitalize"
              >
                {category === "all" ? "All Templates" : category}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={activeCategory} className="mt-0">
            {filteredTemplates.length > 0 ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    allTools={allTools}
                    onSelectTemplate={(tools) =>
                      onSelectTemplate(tools, template)
                    }
                    onUnselectTemplate={
                      onUnselectTemplate
                        ? (toolIds) => onUnselectTemplate(toolIds, template.id)
                        : undefined
                    }
                    isSelected={selectedTemplateIds.includes(template.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-muted-foreground">
                  No templates found matching your criteria
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

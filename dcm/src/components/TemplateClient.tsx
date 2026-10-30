import Providers from "@/components/Providers"
import ActionButtons from "@/components/compose-modal/ActionButtons"
import PortConflictsAlert from "@/components/compose-modal/PortConflictsAlert"
import SelfHostNotes from "@/components/compose-modal/SelfHostNotes"
import {
  ComposeEditor,
  EnvEditor,
  type Monaco,
  type MonacoEditorInstance,
  configureMonacoThemes,
} from "@/components/editors/MonacoEditor"
import { SelfHostCommand } from "@/components/selfhost-command"
import SettingsForm from "@/components/settings/SettingsForm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useClipboard } from "@/hooks/use-clipboard"
import { type CatalogEntry, selfHostRecipeId } from "@/lib/catalog"
import { buildExport, pageSecret } from "@/lib/export"
import { downloadFile } from "@/lib/export/download"
import { routes } from "@/lib/routes"
import { useSettings } from "@/lib/settings-context"
import type { Template } from "@/lib/templates"
import { track } from "@/lib/track"
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  ExternalLink,
  File,
  Info,
  Settings,
  Star,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { siDocker } from "simple-icons"

interface TemplateClientProps {
  template: Template
  templateEntries: CatalogEntry[]
}

function TemplateView({ template, templateEntries }: TemplateClientProps) {
  const { settings } = useSettings()
  const [hasMounted, setHasMounted] = useState(false)
  const [activeTab, setActiveTab] = useState("services")
  const [interpolateEnv, setInterpolateEnv] = useState(true)
  const { copy, copied, reset } = useClipboard()

  const recipe = selfHostRecipeId(template)
  const exported = useMemo(
    () =>
      buildExport(template.tools, { entries: templateEntries }, settings, {
        recipe,
        secretFor: pageSecret,
      }),
    [template, templateEntries, settings, recipe],
  )
  const content = interpolateEnv
    ? exported.composeInterpolated
    : exported.compose
  const envContent = exported.env
  const entryIds = exported.entries.map((entry) => entry.id)

  useEffect(() => {
    track({ name: "dcm_template_opened", id: template.id })
  }, [template.id])

  const composeEditorRef = useRef<MonacoEditorInstance | null>(null)
  const envEditorRef = useRef<MonacoEditorInstance | null>(null)

  // Handle download of docker-compose file
  const handleDownload = () => {
    const contentToDownload =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || content
        : envEditorRef.current?.getValue() || envContent

    downloadFile(contentToDownload, activeTab as "compose" | "env")
    track({
      name: "dcm_compose_downloaded",
      count: entryIds.length,
      ids: entryIds,
      file: activeTab as "compose" | "env",
    })
  }

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    const contentToCopy =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || content
        : envEditorRef.current?.getValue() || envContent

    const ok = await copy(contentToCopy, event.currentTarget)
    if (ok) track({ name: "dcm_template_copied", id: template.id })
  }

  const handleComposeEditorDidMount = (editor: MonacoEditorInstance) => {
    composeEditorRef.current = editor
  }

  const handleEnvEditorDidMount = (editor: MonacoEditorInstance) => {
    envEditorRef.current = editor
  }

  const handleBeforeMount = (monaco: Monaco) => {
    configureMonacoThemes(monaco)
  }

  useEffect(() => {
    setHasMounted(true)
  }, [])

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    reset()
  }

  const currentTheme = hasMounted ? "tailwind-dark" : "vs"

  return (
    <div className="relative">
      <div>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Button asChild className="flex items-center gap-2" variant="ghost">
            <a href={routes.templates}>
              <ArrowLeft size={16} />
              Back to Templates
            </a>
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="flex items-center gap-2"
              onClick={handleDownload}
              variant="outline"
            >
              <Download size={16} />
              Download
            </Button>
          </div>
        </div>

        <div className="mb-8">
          <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            {template.icon && (
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-background shadow-xs sm:h-20 sm:w-20">
                <img
                  alt={template.name}
                  className="h-full w-full object-contain p-2"
                  src={template.icon}
                />
              </div>
            )}
            <div className="w-full min-w-0">
              <h1 className="truncate font-bold text-2xl sm:text-3xl">
                {template.name}
              </h1>
              <p className="line-clamp-2 text-muted-foreground sm:line-clamp-none">
                {template.description}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge
                  className="flex items-center gap-1 text-sm"
                  variant="secondary"
                >
                  <Info size={14} />
                  {exported.entries.length} tools included
                </Badge>

                {exported.unresolved.length > 0 && (
                  <Badge
                    className="flex items-center gap-1 text-amber-500 text-sm"
                    variant="outline"
                  >
                    <AlertTriangle size={14} />
                    {exported.unresolved.length} unavailable
                  </Badge>
                )}

                <Badge
                  className="flex items-center gap-1 text-sm"
                  variant="outline"
                >
                  {template.category}
                </Badge>
              </div>

              {recipe && (
                <div className="mt-4">
                  <SelfHostCommand
                    command={exported.selfHostCommand}
                    ids={exported.selfHostIds}
                    prominent
                  />
                </div>
              )}

              {exported.installOnly.length > 0 && (
                <p className="mt-3 text-muted-foreground text-sm">
                  {exported.installOnly.map((tool) => tool.name).join(", ")} ha
                  {exported.installOnly.length === 1 ? "s" : "ve"} no standalone
                  Compose file, so{" "}
                  {exported.installOnly.length === 1 ? "it is" : "they are"}{" "}
                  left out of the YAML. Install with self-host instead.
                </p>
              )}
            </div>
          </div>
        </div>

        <SelfHostNotes notes={exported.notes} />

        <Card className="mb-8 border shadow-xs">
          <Tabs
            defaultValue="services"
            value={activeTab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4">
                  <TabsTrigger
                    value="services"
                    className="text-xs sm:text-base"
                  >
                    Services
                  </TabsTrigger>
                  <TabsTrigger value="compose" className="text-xs sm:text-base">
                    <svg
                      aria-label="Docker"
                      role="img"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      className="mr-1 h-3 w-3 fill-current sm:h-4 sm:w-4"
                    >
                      <path d={siDocker.path} />
                    </svg>
                    Compose
                  </TabsTrigger>
                  <TabsTrigger value="env" className="text-xs sm:text-base">
                    <File className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                    Env
                  </TabsTrigger>
                  <TabsTrigger
                    value="settings"
                    className="text-xs sm:text-base"
                  >
                    <Settings className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                    Settings
                  </TabsTrigger>
                </TabsList>
              </div>

              <Separator className="mt-2" />
            </CardHeader>

            <CardContent className="pt-6">
              <TabsContent value="services" className="mt-0">
                <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {exported.entries.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex flex-col items-start gap-4 rounded-md border bg-card p-4 shadow-xs transition-colors hover:bg-accent/10 sm:flex-row sm:items-center"
                    >
                      {tool.icon && (
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-background">
                          <img
                            alt={tool.name}
                            className="h-full w-full object-contain p-1"
                            src={tool.icon}
                          />
                        </div>
                      )}

                      <div className="w-full min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <div className="truncate font-medium text-lg">
                            {tool.name}
                          </div>
                          {tool.githubUrl && (
                            <Button
                              asChild
                              className="h-8 w-8 p-0"
                              size="sm"
                              variant="ghost"
                            >
                              <a
                                href={tool.githubUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink size={16} />
                              </a>
                            </Button>
                          )}
                        </div>
                        <div className="line-clamp-2 text-muted-foreground text-sm">
                          {tool.description}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {tool.stars && (
                            <Badge
                              className="flex items-center gap-1 text-xs"
                              variant="secondary"
                            >
                              <Star size={12} />
                              {tool.stars.toLocaleString()}
                            </Badge>
                          )}
                          {tool.category && (
                            <Badge className="text-xs" variant="outline">
                              {tool.category}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {exported.unresolved.length > 0 && (
                  <div className="mt-8">
                    <h3 className="mb-4 font-medium text-lg">
                      Unavailable Services
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                      {exported.unresolved.map((id) => (
                        <div
                          key={id}
                          className="flex items-center gap-3 rounded-md border bg-muted/30 p-4 shadow-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{id}</div>
                            <div className="line-clamp-2 text-muted-foreground text-sm">
                              This service is currently unavailable
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="compose" className="mt-0">
                <PortConflictsAlert changes={exported.portChanges} />

                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="interpolate-env"
                      checked={interpolateEnv}
                      onCheckedChange={setInterpolateEnv}
                    />
                    <Label
                      htmlFor="interpolate-env"
                      className="font-medium text-sm"
                    >
                      Interpolate environment variables
                    </Label>
                  </div>

                  <ActionButtons
                    onCopy={handleCopy}
                    onDownload={handleDownload}
                    copied={copied}
                  />
                </div>

                <div className="h-[750px] w-full rounded-md border bg-card shadow-xs">
                  <ComposeEditor
                    content={content}
                    onMount={handleComposeEditorDidMount}
                    beforeMount={handleBeforeMount}
                    theme={currentTheme}
                    readOnly={false}
                  />
                </div>
              </TabsContent>

              <TabsContent value="env" className="mt-0">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-muted-foreground text-sm">
                    Environment variables for your Docker Compose configuration.
                  </p>

                  <ActionButtons
                    onCopy={handleCopy}
                    onDownload={handleDownload}
                    copied={copied}
                  />
                </div>

                <div className="h-[750px] w-full rounded-md border bg-card shadow-xs">
                  <EnvEditor
                    content={envContent}
                    onMount={handleEnvEditorDidMount}
                    beforeMount={handleBeforeMount}
                    theme={currentTheme}
                    readOnly={false}
                  />
                </div>
              </TabsContent>

              <TabsContent value="settings" className="mt-0">
                <SettingsForm />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  )
}

export default function TemplateClient(props: TemplateClientProps) {
  return (
    <Providers>
      <TemplateView {...props} />
    </Providers>
  )
}

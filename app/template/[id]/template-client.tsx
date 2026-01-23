"use client"

import ActionButtons from "@/components/compose-modal/ActionButtons"
import PortConflictsAlert from "@/components/compose-modal/PortConflictsAlert"
import {
  ComposeEditor,
  EnvEditor,
  configureMonacoThemes,
} from "@/components/editors/MonacoEditor"
import SettingsForm from "@/components/settings/SettingsForm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  copyToClipboard,
  downloadFile,
} from "@/lib/docker-compose/file-operations"
import {
  generateComposeContent,
  generateEnvFile,
} from "@/lib/docker-compose/generators"
import type { PortConflictsResult } from "@/lib/docker-compose/port-conflicts"
import type { DockerTool } from "@/lib/docker-tools"
import { useSettings } from "@/lib/settings-context"
import type { Template } from "@/lib/templates"
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
import type { editor } from "monaco-editor"
import { useTheme } from "next-themes"
import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { siDocker } from "simple-icons"

interface TemplateClientProps {
  template: Template
  templateTools: DockerTool[]
  unavailableTools: { id: string }[]
  initialContent: string
}

export function TemplateClient({
  template,
  templateTools,
  unavailableTools,
  initialContent,
}: TemplateClientProps) {
  const [content, setContent] = useState(initialContent)
  const [envContent, setEnvContent] = useState("")
  const { settings, isLoading } = useSettings()
  const [hasMounted, setHasMounted] = useState(false)
  const [activeTab, setActiveTab] = useState("services")
  const [interpolateEnv, setInterpolateEnv] = useState(true)
  const [copied, setCopied] = useState(false)
  const [portConflicts, setPortConflicts] = useState<PortConflictsResult | null>(
    null,
  )

  const composeEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const envEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const { resolvedTheme } = useTheme()

  // Handle download of docker-compose file
  const handleDownload = () => {
    const contentToDownload =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || content
        : envEditorRef.current?.getValue() || envContent

    downloadFile(
      contentToDownload,
      activeTab as "compose" | "env",
      templateTools,
      settings,
    )
  }

  // Handle copy to clipboard
  const handleCopy = async () => {
    const contentToCopy =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || content
        : envEditorRef.current?.getValue() || envContent

    const success = await copyToClipboard(
      contentToCopy,
      activeTab as "compose" | "env",
      templateTools,
      settings,
    )

    if (success) {
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 2000)
    }
  }

  const handleComposeEditorDidMount = (
    editor: editor.IStandaloneCodeEditor,
  ) => {
    composeEditorRef.current = editor

    if (hasMounted) {
      const currentTheme =
        resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"
      editor.updateOptions({ theme: currentTheme })
    }
  }

  const handleEnvEditorDidMount = (editor: editor.IStandaloneCodeEditor) => {
    envEditorRef.current = editor

    if (hasMounted) {
      const currentTheme =
        resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"
      editor.updateOptions({ theme: currentTheme })
    }
  }

  const handleBeforeMount = (monaco: typeof import("monaco-editor")) => {
    configureMonacoThemes(monaco)
  }

  useEffect(() => {
    setHasMounted(true)
  }, [])

  // Update content when settings change (from localStorage) or interpolation toggle changes
  useEffect(() => {
    if (!hasMounted || isLoading) return

    // Generate content with user settings from localStorage
    const { content: composeContent, portConflicts: conflicts } =
      generateComposeContent(templateTools, settings, interpolateEnv)

    setContent(composeContent)
    setPortConflicts(conflicts)

    // Generate env file
    const envFileContent = generateEnvFile(templateTools, settings)
    setEnvContent(envFileContent)
  }, [templateTools, settings, isLoading, hasMounted, interpolateEnv])

  useEffect(() => {
    setCopied(false)
  }, [activeTab])

  useEffect(() => {
    if (!hasMounted) return

    if (composeEditorRef.current) {
      const currentTheme =
        resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"
      composeEditorRef.current.updateOptions({ theme: currentTheme })
    }

    if (envEditorRef.current) {
      const currentTheme =
        resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"
      envEditorRef.current.updateOptions({ theme: currentTheme })
    }
  }, [resolvedTheme, hasMounted])

  // Handle tab changes with proper theme application
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    setCopied(false)

    // Apply theme to the appropriate editor if it's already mounted
    if (hasMounted) {
      const currentTheme =
        resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"

      if (tab === "compose" && composeEditorRef.current) {
        composeEditorRef.current.updateOptions({ theme: currentTheme })
      } else if (tab === "env" && envEditorRef.current) {
        envEditorRef.current.updateOptions({ theme: currentTheme })
      }
    }
  }

  const currentTheme = !hasMounted
    ? "vs"
    : resolvedTheme === "dark"
      ? "tailwind-dark"
      : "tailwind-light"

  return (
    <div className="relative min-h-screen bg-background">
      {/* Background decoration */}
      <div className="pointer-events-none absolute top-0 left-0 z-0 h-full w-full bg-stripes opacity-30" />

      <main className="container relative z-10 mx-auto px-4 pt-4 pb-12">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/templates">
            <Button className="flex items-center gap-2" variant="ghost">
              <ArrowLeft size={16} />
              Back to Templates
            </Button>
          </Link>

          <div className="flex items-center gap-2">
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
          <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            {template.icon && (
              <div className="relative h-16 w-16 sm:h-20 sm:w-20 flex-shrink-0 overflow-hidden rounded-md border bg-background shadow-sm">
                <Image
                  alt={template.name}
                  className="object-contain p-2"
                  fill
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
                  {templateTools.length} tools included
                </Badge>

                {unavailableTools.length > 0 && (
                  <Badge
                    className="flex items-center gap-1 text-amber-500 text-sm"
                    variant="outline"
                  >
                    <AlertTriangle size={14} />
                    {unavailableTools.length} unavailable
                  </Badge>
                )}

                <Badge
                  className="flex items-center gap-1 text-sm"
                  variant="outline"
                >
                  {template.category}
                </Badge>
              </div>
            </div>
          </div>
        </div>

        <Card className="mb-8 border shadow-sm">
          <Tabs
            defaultValue="services"
            value={activeTab}
            onValueChange={handleTabChange}
            className="w-full"
          >
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1">
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
                      className="mr-1 h-3 w-3 sm:h-4 sm:w-4 fill-current"
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
                  {templateTools.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center gap-4 rounded-md border bg-card p-4 shadow-sm transition-colors hover:bg-accent/10"
                    >
                      {tool.icon && (
                        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md border bg-background">
                          <Image
                            alt={tool.name}
                            className="object-contain p-1"
                            fill
                            src={tool.icon}
                          />
                        </div>
                      )}

                      <div className="min-w-0 w-full flex-1">
                        <div className="flex items-center justify-between">
                          <div className="truncate font-medium text-lg">
                            {tool.name}
                          </div>
                          {tool.githubUrl && (
                            <Link
                              href={tool.githubUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button
                                className="h-8 w-8 p-0"
                                size="sm"
                                variant="ghost"
                              >
                                <ExternalLink size={16} />
                              </Button>
                            </Link>
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

                {unavailableTools.length > 0 && (
                  <div className="mt-8">
                    <h3 className="mb-4 font-medium text-lg">
                      Unavailable Services
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                      {unavailableTools.map((tool) => (
                        <div
                          key={tool.id}
                          className="flex items-center gap-3 rounded-md border bg-muted/30 p-4 shadow-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">
                              {tool.id}
                            </div>
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
                {portConflicts && (
                  <PortConflictsAlert portConflicts={portConflicts} />
                )}

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

                <div className="h-[750px] w-full rounded-md border bg-card shadow-sm">
                  <ComposeEditor
                    value={content}
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

                <div className="h-[750px] w-full rounded-md border bg-card shadow-sm">
                  <EnvEditor
                    value={envContent}
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
      </main>
    </div>
  )
}

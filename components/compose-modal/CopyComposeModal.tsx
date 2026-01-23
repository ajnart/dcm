"use client"

import { File } from "lucide-react"
import type { editor } from "monaco-editor"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"
import { siDocker } from "simple-icons"

import SettingsForm from "@/components/settings/SettingsForm"
import type { DockerTool } from "@/lib/docker-tools"
import { useSettings } from "@/lib/settings-context"
import type { PortConflictsResult } from "@/lib/docker-compose/port-conflicts"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Settings } from "lucide-react"

import {
  ComposeEditor,
  EnvEditor,
  configureMonacoThemes,
} from "@/components/editors/MonacoEditor"
import {
  copyToClipboard,
  downloadFile,
} from "@/lib/docker-compose/file-operations"
import {
  generateComposeContent,
  generateEnvFileContent,
} from "@/lib/docker-compose/generators"
import ActionButtons from "./ActionButtons"
import PortConflictsAlert from "./PortConflictsAlert"

interface CopyComposeModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedTools: DockerTool[]
}

export function CopyComposeModal({
  isOpen,
  onOpenChange,
  selectedTools,
}: CopyComposeModalProps) {
  const [showInterpolated, setShowInterpolated] = useState(false)
  const [composeContent, setComposeContent] = useState<string>("")
  const [envFileContent, setEnvFileContent] = useState<string>("")
  const [activeTab, setActiveTab] = useState<string>("compose")
  const [copied, setCopied] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [portConflicts, setPortConflicts] = useState<PortConflictsResult | null>(
    null,
  )

  const composeEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const envEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const { theme, resolvedTheme } = useTheme()
  const { settings } = useSettings()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const envContent = generateEnvFileContent(settings)
    setEnvFileContent(envContent)

    const { content, portConflicts } = generateComposeContent(
      selectedTools,
      settings,
      showInterpolated,
    )

    setComposeContent(content)
    setPortConflicts(portConflicts)
  }, [isOpen, selectedTools, settings, showInterpolated])

  useEffect(() => {
    setCopied(false)
  }, [activeTab])

  useEffect(() => {
    if (!mounted) return

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
  }, [resolvedTheme, mounted])

  const handleCopy = async () => {
    const content =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || composeContent
        : envEditorRef.current?.getValue() || envFileContent

    const success = await copyToClipboard(
      content,
      activeTab as "compose" | "env",
      selectedTools,
      settings,
    )

    if (success) {
      setCopied(true)

      const button = document.getElementById("copy-button")
      if (button) {
        button.classList.add("hover:motion-preset-confetti")
        setTimeout(() => {
          button.classList.remove("hover:motion-preset-confetti")
        }, 1000)
      }

      setTimeout(() => {
        setCopied(false)
      }, 2000)
    }
  }

  const handleDownload = () => {
    const content =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || composeContent
        : envEditorRef.current?.getValue() || envFileContent

    downloadFile(
      content,
      activeTab as "compose" | "env",
      selectedTools,
      settings,
    )
  }

  const handleComposeEditorDidMount = (
    editor: editor.IStandaloneCodeEditor,
  ) => {
    composeEditorRef.current = editor

    if (mounted) {
      const currentTheme =
        resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"
      editor.updateOptions({ theme: currentTheme })
    }
  }

  const handleEnvEditorDidMount = (editor: editor.IStandaloneCodeEditor) => {
    envEditorRef.current = editor

    if (mounted) {
      const currentTheme =
        resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"
      editor.updateOptions({ theme: currentTheme })
    }
  }

  const currentTheme = !mounted
    ? "vs"
    : resolvedTheme === "dark"
      ? "tailwind-dark"
      : "tailwind-light"

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent className="flex h-[90vh] max-w-[95vw] flex-col overflow-y-auto">
        <AlertDialogHeader className="flex flex-row items-center justify-between">
          <div>
            <AlertDialogTitle>Docker Compose Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Generated docker-compose files for {selectedTools.length} selected
              service{selectedTools.length !== 1 ? "s" : ""}.
            </AlertDialogDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="interpolate-values"
                checked={showInterpolated}
                onCheckedChange={setShowInterpolated}
              />
              <Label htmlFor="interpolate-values">
                Show interpolated values
              </Label>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="flex-1">
          {portConflicts && (
            <PortConflictsAlert portConflicts={portConflicts} />
          )}

          <Tabs
            className="w-full"
            defaultValue="compose"
            onValueChange={setActiveTab}
            value={activeTab}
          >
            <TabsList className="mb-4 grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="compose">
                <svg
                  aria-label="Docker"
                  role="img"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                  className="mr-2 h-4 w-4 fill-current"
                >
                  <path d={siDocker.path} />
                </svg>
                docker-compose.yaml
              </TabsTrigger>
              <TabsTrigger value="env">
                <File className="mr-2 h-4 w-4" />
                .env
              </TabsTrigger>
              <TabsTrigger value="settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="compose">
              <div className="mb-2 flex items-center justify-end">
                <ActionButtons
                  onCopy={handleCopy}
                  onDownload={handleDownload}
                  copied={copied}
                />
              </div>

              <div className="h-[calc(65vh-40px)] flex-1 overflow-hidden rounded border">
                <ComposeEditor
                  content={composeContent}
                  onMount={handleComposeEditorDidMount}
                  beforeMount={configureMonacoThemes}
                  theme={currentTheme}
                />
              </div>
            </TabsContent>

            <TabsContent value="env">
              <div className="mb-2 flex items-center justify-end">
                <ActionButtons
                  onCopy={handleCopy}
                  onDownload={handleDownload}
                  copied={copied}
                />
              </div>

              <div className="h-[calc(65vh-40px)] flex-1 overflow-hidden rounded border">
                <EnvEditor
                  content={envFileContent}
                  onMount={handleEnvEditorDidMount}
                  theme={currentTheme}
                />
              </div>
            </TabsContent>

            <TabsContent value="settings">
              <SettingsForm />
            </TabsContent>
          </Tabs>
        </div>

        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onOpenChange.bind(null, false)}>
            Done
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

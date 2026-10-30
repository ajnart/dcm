import { File } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { siDocker } from "simple-icons"

import SettingsForm from "@/components/settings/SettingsForm"
import { useClipboard } from "@/hooks/use-clipboard"
import type { CatalogEntry } from "@/lib/catalog"
import { useSettings } from "@/lib/settings-context"

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
  type MonacoEditorInstance,
  configureMonacoThemes,
} from "@/components/editors/MonacoEditor"
import { downloadFile } from "@/lib/docker-compose/file-operations"
import {
  generateComposeContent,
  generateEnvFile,
} from "@/lib/docker-compose/generators"
import ActionButtons from "./ActionButtons"
import PortConflictsAlert from "./PortConflictsAlert"
import SelfHostCallout from "./SelfHostCallout"
import SelfHostNotes from "./SelfHostNotes"

interface CopyComposeModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedTools: CatalogEntry[]
  yamlMissing: CatalogEntry[]
  selfHostIds: string[]
}

export function CopyComposeModal({
  isOpen,
  onOpenChange,
  selectedTools,
  yamlMissing,
  selfHostIds,
}: CopyComposeModalProps) {
  const [showInterpolated, setShowInterpolated] = useState(false)
  const [composeContent, setComposeContent] = useState<string>("")
  const [envFileContent, setEnvFileContent] = useState<string>("")
  const [activeTab, setActiveTab] = useState<string>("compose")
  const { copy, copied, reset } = useClipboard()
  const [mounted, setMounted] = useState(false)
  const [portConflicts, setPortConflicts] = useState<{
    fixed: number
    conflicts: string[]
  } | null>(null)

  const composeEditorRef = useRef<MonacoEditorInstance | null>(null)
  const envEditorRef = useRef<MonacoEditorInstance | null>(null)

  const { settings } = useSettings()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const envContent = generateEnvFile(selectedTools, settings)
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
    reset()
  }, [activeTab, reset])

  const handleCopy = (event: React.MouseEvent<HTMLButtonElement>) => {
    const content =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || composeContent
        : envEditorRef.current?.getValue() || envFileContent

    copy(content, event.currentTarget)
  }

  const handleDownload = () => {
    const content =
      activeTab === "compose"
        ? composeEditorRef.current?.getValue() || composeContent
        : envEditorRef.current?.getValue() || envFileContent

    downloadFile(content, activeTab as "compose" | "env", selectedTools)
  }

  const handleComposeEditorDidMount = (editor: MonacoEditorInstance) => {
    composeEditorRef.current = editor
  }

  const handleEnvEditorDidMount = (editor: MonacoEditorInstance) => {
    envEditorRef.current = editor
  }

  const currentTheme = mounted ? "tailwind-dark" : "vs"

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent className="flex h-[90vh] max-w-[95vw] flex-col overflow-y-auto">
        <AlertDialogHeader className="flex flex-row items-center justify-between space-y-0">
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

          <SelfHostNotes notes={[...selectedTools, ...yamlMissing]} />

          <Tabs
            className="w-full"
            defaultValue="compose"
            onValueChange={setActiveTab}
            value={activeTab}
          >
            <TabsList className="mb-4 h-auto max-w-full flex-wrap justify-start">
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

        <AlertDialogFooter className="mt-4 sm:items-center">
          <SelfHostCallout ids={selfHostIds} yamlMissing={yamlMissing} />
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onOpenChange.bind(null, false)}>
            Done
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

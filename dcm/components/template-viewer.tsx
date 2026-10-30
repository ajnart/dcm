"use client"

import {
  ComposeEditor,
  configureMonacoThemes,
} from "@/components/editors/MonacoEditor"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import type { editor } from "monaco-editor"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState } from "react"

interface TemplateViewerProps {
  content: string
  templateId: string
  templateName: string
  language?: string
  readOnly?: boolean
}

export function TemplateViewer({
  content,
  templateId,
  templateName,
  language = "yaml",
  readOnly = true,
}: TemplateViewerProps) {
  const [mounted, setMounted] = useState(false)
  const composeEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || !composeEditorRef.current) return

    const currentTheme =
      resolvedTheme === "dark" ? "tailwind-dark" : "tailwind-light"
    composeEditorRef.current.updateOptions({ theme: currentTheme })
  }, [resolvedTheme, mounted])

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

  const handleBeforeMount = (monaco: typeof import("monaco-editor")) => {
    configureMonacoThemes(monaco)
  }

  const handleDownload = () => {
    // Create a blob with the content
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)

    // Create an anchor element and trigger download
    const a = document.createElement("a")
    a.href = url
    a.download =
      language === "yaml"
        ? `docker-compose-${templateId}.yml`
        : `.env-${templateId}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Clean up the URL
    URL.revokeObjectURL(url)
  }

  const currentTheme = !mounted
    ? "vs"
    : resolvedTheme === "dark"
      ? "tailwind-dark"
      : "tailwind-light"

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h2 className="font-semibold text-xl">
            {language === "yaml"
              ? "Docker Compose Configuration"
              : "Environment Variables"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {language === "yaml"
              ? `This is the Docker Compose configuration for the ${templateName} template.`
              : `Environment variables for the ${templateName} template.`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
          onClick={handleDownload}
        >
          <Download size={14} />
          Download
        </Button>
      </div>
      <div className="h-[700px] w-full">
        <ComposeEditor
          value={content}
          onMount={handleComposeEditorDidMount}
          beforeMount={handleBeforeMount}
          theme={currentTheme}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}

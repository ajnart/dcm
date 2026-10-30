import Editor, { type Monaco, type OnMount } from "@monaco-editor/react"
import { memo, useEffect, useState } from "react"

export type { Monaco }
export type MonacoEditorInstance = Parameters<OnMount>[0]

export const configureMonacoThemes = (monaco: Monaco) => {
  monaco.editor.defineTheme("tailwind-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#171621",
      "editor.foreground": "#e4e4ea",
      "editorCursor.foreground": "#a88df2",
      "editor.lineHighlightBackground": "#23222f",
      "editorLineNumber.foreground": "#9995a6",
      "editor.selectionBackground": "#2b2140",
      "editor.inactiveSelectionBackground": "#23222f",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#777185",
      "scrollbarSlider.hoverBackground": "#aaa8b5",
      "scrollbarSlider.activeBackground": "#aaa8b5",
    },
  })
}

const useBundledMonaco = () => {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let mounted = true
    void import("@/lib/monaco-setup").then(() => {
      if (mounted) setReady(true)
    })
    return () => {
      mounted = false
    }
  }, [])

  return ready
}

interface BaseEditorProps {
  value?: string
  content?: string
  onMount?: (editor: MonacoEditorInstance) => void
  theme?: string
  beforeMount?: (monaco: Monaco) => void
  readOnly?: boolean
}

interface LanguageEditorProps extends BaseEditorProps {
  language: "yaml" | "ini"
}

const LanguageEditor = ({
  value,
  content,
  onMount,
  beforeMount,
  language,
  theme = "vs",
  readOnly = false,
}: LanguageEditorProps) => {
  const ready = useBundledMonaco()
  if (!ready) return null

  return (
    <Editor
      defaultLanguage={language}
      defaultValue={content || value}
      height="100%"
      onMount={onMount}
      beforeMount={beforeMount}
      options={{
        automaticLayout: true,
        fontSize: 13,
        minimap: { enabled: false },
        readOnly,
        scrollBeyondLastLine: false,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
        wordWrap: "on",
      }}
      theme={theme}
      value={content || value}
    />
  )
}

export const ComposeEditor = memo((props: BaseEditorProps) => (
  <LanguageEditor {...props} language="yaml" />
))

ComposeEditor.displayName = "ComposeEditor"

export const EnvEditor = memo((props: BaseEditorProps) => (
  <LanguageEditor {...props} language="ini" />
))

EnvEditor.displayName = "EnvEditor"

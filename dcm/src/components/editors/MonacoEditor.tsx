import Editor from "@monaco-editor/react"
import { memo } from "react"

export const configureMonacoThemes = (
  monaco: typeof import("monaco-editor"),
) => {
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
    },
  })
}

interface BaseEditorProps {
  value?: string
  content?: string
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  onMount?: (editor: any) => void
  theme?: string
  beforeMount?: (monaco: typeof import("monaco-editor")) => void
  readOnly?: boolean
}

export const ComposeEditor = memo(
  ({
    value,
    content,
    onMount,
    beforeMount,
    theme = "vs",
    readOnly = false,
  }: BaseEditorProps) => (
    <Editor
      defaultLanguage="yaml"
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
        wordWrap: "on",
      }}
      theme={theme}
      value={content || value}
    />
  ),
)

ComposeEditor.displayName = "ComposeEditor"

export const EnvEditor = memo(
  ({
    value,
    content,
    onMount,
    beforeMount,
    theme = "vs",
    readOnly = false,
  }: BaseEditorProps) => (
    <Editor
      defaultLanguage="ini"
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
        wordWrap: "on",
      }}
      theme={theme}
      value={content || value}
    />
  ),
)

EnvEditor.displayName = "EnvEditor"

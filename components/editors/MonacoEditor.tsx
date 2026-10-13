"use client"

import Editor, { type OnMount } from "@monaco-editor/react"
import { memo } from "react"

const THEME = "selfhost"

const defineTheme = (monaco: typeof import("monaco-editor")) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "5c5c68" },
      { token: "string", foreground: "00d787" },
      { token: "number", foreground: "ffaf00" },
      { token: "type", foreground: "5fd7ff" },
      { token: "keyword", foreground: "ff87d7" },
    ],
    colors: {
      "editor.background": "#171621",
      "editor.foreground": "#e4e4ea",
      "editorCursor.foreground": "#ff87d7",
      "editor.lineHighlightBackground": "#23222f",
      "editorLineNumber.foreground": "#5c5c68",
      "editorLineNumber.activeForeground": "#a77bff",
      "editor.selectionBackground": "#5f00ff55",
      "editor.inactiveSelectionBackground": "#5f00ff30",
      "editorWidget.background": "#23222f",
      "editorWidget.border": "#3a3947",
    },
  })
}

interface EditorProps {
  content: string
  onMount?: OnMount
  readOnly?: boolean
}

const createEditor = (language: string, displayName: string) => {
  const Component = memo(
    ({ content, onMount, readOnly = false }: EditorProps) => (
      <Editor
        defaultLanguage={language}
        height="100%"
        onMount={onMount}
        beforeMount={defineTheme}
        options={{
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: false },
          readOnly,
          scrollBeyondLastLine: false,
          wordWrap: "on",
        }}
        theme={THEME}
        value={content}
      />
    ),
  )
  Component.displayName = displayName
  return Component
}

export const ComposeEditor = createEditor("yaml", "ComposeEditor")
export const EnvEditor = createEditor("ini", "EnvEditor")

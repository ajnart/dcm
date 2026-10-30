import { loader } from "@monaco-editor/react"
import * as monaco from "monaco-editor/editor/editor.api"
import EditorWorker from "monaco-editor/editor/editor.worker?worker"
import "monaco-editor/features/register.all"
import "monaco-editor/languages/definitions/ini/register"
import "monaco-editor/languages/definitions/yaml/register"

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

loader.config({ monaco })

import { DiffEditor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
loader.config({ monaco })
monaco.editor.defineTheme('pi-dark', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#121314', 'editor.foreground': '#BBBEBF', 'editorLineNumber.foreground': '#858889', 'editor.lineHighlightBackground': '#242526' } })
monaco.editor.defineTheme('pi-light', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#f2f2ee', 'editor.foreground': '#252728' } })
export default DiffEditor


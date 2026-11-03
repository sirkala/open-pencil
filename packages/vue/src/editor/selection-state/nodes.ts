import { tryOnScopeDispose, watchImmediate } from '@vueuse/core'
import { computed, effectScope, shallowReactive, shallowRef } from 'vue'
import type { ComputedRef, EffectScope, Ref } from 'vue'

import type { Editor } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditor } from '#vue/editor/context'
import { useRetainedActivity } from '#vue/lifecycle/retention/context'

export interface SelectedNodeState {
  nodes: ComputedRef<SceneNode[]>
  node: ComputedRef<SceneNode | null>
  dispose: () => void
}

/**
 * The selected layers as the graph holds them, without the copy `getSelectedNodes()` makes of
 * each: for checks that only read them, which run again on every scene change.
 */
export function readSelectedNodes(editor: Editor): readonly Readonly<SceneNode>[] {
  const nodes: SceneNode[] = []
  for (const id of editor.state.selectedIds) {
    const node = editor.graph.getNode(id)
    if (node) nodes.push(node)
  }
  return nodes
}

/**
 * The selected layers as the panel shows them: text has the style of its first character, or of
 * its selected characters while it is edited, which the panel then edits. Layers without a text
 * style are the graph's own, so callers copy before they keep or change them.
 */
export function selectedNodesAsShown(editor: Editor): readonly Readonly<SceneNode>[] {
  if (editor.state.editingTextId) void editor.state.textSelectionVersion
  return readSelectedNodes(editor).map((node) => {
    const style = editor.getTextSelectionStyle(node)
    return style ? { ...node, ...style } : node
  })
}

/** Selected-node copies with property-level preview tracking; never proxies the graph. */
export function createSelectedNodeState(
  editor: Editor,
  active?: Readonly<Ref<boolean>>
): SelectedNodeState {
  const revision = shallowRef(0)
  const refresh = () => {
    revision.value++
  }
  const refreshSelected = (id: string) => {
    if (editor.state.selectedIds.has(id)) refresh()
  }
  const nodes = computed<SceneNode[]>((previous) => {
    if (active?.value === false && previous) return previous
    void revision.value
    void editor.state.sceneVersion
    void editor.state.currentPageId
    return selectedNodesAsShown(editor).map((node) => shallowReactive(structuredClone(node)))
  })
  const byId = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
  // Only one selected layer has a node, so a larger selection is not copied to answer it.
  const node = computed<SceneNode | null>((previous) => {
    if (active?.value === false && previous !== undefined) return previous
    void revision.value
    if (editor.state.selectedIds.size !== 1) return null
    return nodes.value.length === 1 ? nodes.value[0] : null
  })

  function updatePreview(id: string, changes: Partial<SceneNode>) {
    if (!editor.state.selectedIds.has(id)) return
    const selected = byId.value.get(id)
    if (selected) Object.assign(selected, structuredClone(changes))
  }

  const dispose = watchImmediate(
    () => active?.value ?? true,
    (enabled, _previous, onCleanup) => {
      if (!enabled) return
      refresh()
      onCleanup(editor.onEditorEvent('node:previewUpdated', updatePreview))
      onCleanup(editor.onEditorEvent('node:updated', refreshSelected))
      onCleanup(editor.onEditorEvent('selection:changed', refresh))
      onCleanup(editor.onEditorEvent('graph:replaced', refresh))
      onCleanup(editor.onEditorEvent('page:changed', refresh))
      onCleanup(editor.onEditorEvent('node:created', refresh))
      onCleanup(editor.onEditorEvent('node:deleted', refresh))
      onCleanup(editor.onEditorEvent('node:reparented', refresh))
      onCleanup(editor.onEditorEvent('node:reordered', refresh))
    },
    { flush: 'sync' }
  )
  return { nodes, node, dispose }
}

type RetainedActivity = Readonly<Ref<boolean>> | undefined

interface SharedSelectedNodeState {
  state: SelectedNodeState
  scope: EffectScope
  users: number
}

const sharedStates = new WeakMap<Editor, Map<RetainedActivity, SharedSelectedNodeState>>()

/**
 * One projection for every component of an editor that pauses and resumes together: the
 * property sections of a panel each read the selection, and each copying every selected layer on
 * every scene change made editing a large selection slow. It lives in a scope of its own, so the
 * first component to unmount does not stop it for the others, and the last one disposes it.
 */
function acquireSelectedNodeState(editor: Editor, active: RetainedActivity): SelectedNodeState {
  let byActivity = sharedStates.get(editor)
  if (!byActivity) {
    byActivity = new Map()
    sharedStates.set(editor, byActivity)
  }
  let shared = byActivity.get(active)
  if (!shared) {
    const scope = effectScope(true)
    const state = scope.run(() => createSelectedNodeState(editor, active))
    if (!state) throw new Error('Selected-node state scope did not run')
    shared = { state, scope, users: 0 }
    byActivity.set(active, shared)
  }
  const entry = shared
  entry.users++
  let released = false
  return {
    nodes: entry.state.nodes,
    node: entry.state.node,
    dispose() {
      if (released) return
      released = true
      if (--entry.users > 0) return
      entry.state.dispose()
      entry.scope.stop()
      byActivity.delete(active)
    }
  }
}

export function useSelectedNodeState(editor = useEditor()): SelectedNodeState {
  const state = acquireSelectedNodeState(editor, useRetainedActivity())
  tryOnScopeDispose(state.dispose)
  return state
}

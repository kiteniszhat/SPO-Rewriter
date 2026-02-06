import { useState, useCallback } from 'react'
import type { NodeId, GraphNode, GraphEdge } from '../Types'

type UseGraphStateReturn = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  pendingFrom: NodeId | null
  nextId: NodeId
  addNode: (x: number, y: number) => NodeId
  addEdge: (source: NodeId, target: NodeId) => void
  removeNode: (id: NodeId) => void
  removeEdge: (source: NodeId, target: NodeId) => void
  toggleEdge: (a: NodeId, b: NodeId) => void
  setPending: (nodeId: NodeId | null) => void
  reset: () => void
  setNodes: (nodes: GraphNode[]) => void
  setEdges: (edges: GraphEdge[]) => void
  createOnBackgroundClick: (svgRef: React.RefObject<SVGSVGElement | null>, isDisabled: boolean) => (e: React.MouseEvent<SVGSVGElement>) => void
  createOnBackgroundContextMenu: () => (e: React.MouseEvent) => void
  createOnNodeContextMenu: (nodeId: NodeId, e: React.MouseEvent) => void 
  createOnNodeClick: (mappingActive: boolean, mappingQueue: NodeId[], mappingIndex: number, mapping: Record<number, number>, setMapping: (m: Record<number, number>) => void, setMappingIndex: (i: number) => void, setMappingActive: (a: boolean) => void) => (nodeId: NodeId, e: React.MouseEvent) => void
}

export function useGraphState(): UseGraphStateReturn {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [pendingFrom, setPendingFrom] = useState<NodeId | null>(null)
  const [nextId, setNextId] = useState<NodeId>(1)

  const addNode = useCallback((x: number, y: number): NodeId => {
    const newNode: GraphNode = { id: nextId, x, y }
    setNodes(prev => [...prev, newNode])
    setNextId(prev => prev + 1)
    return nextId
  }, [nextId])

  const addEdge = useCallback((source: NodeId, target: NodeId) => {
    console.log(`[addEdge] Adding edge ${source} -> ${target}`)
    const newEdge: GraphEdge = { source, target }
    setEdges(prev => [...prev, newEdge])
  }, [])

  const removeNode = useCallback((id: NodeId) => {
    setNodes(prev => prev.filter(node => node.id !== id))
    setEdges(prev => prev.filter(edge => edge.source !== id && edge.target !== id))
  }, [])

  const removeEdge = useCallback((source: NodeId, target: NodeId) => {
    setEdges(prev => prev.filter(edge => !(edge.source === source && edge.target === target)))
  }, [])

  const toggleEdge = useCallback((a: NodeId, b: NodeId) => {
    if (a === b) return
    setEdges(prev => {
      const idx = prev.findIndex(
        (ed) => (ed.source === a && ed.target === b) || (ed.source === b && ed.target === a)
      )
      if (idx !== -1) {
        console.log(`[toggleEdge] Removed edge ${a} -> ${b}`)
        const next = [...prev]
        next.splice(idx, 1)
        return next
      }
      console.log(`[toggleEdge] Added edge ${a} -> ${b}`)
      return [...prev, { source: a, target: b }]
    })
  }, [])

  const setPending = useCallback((nodeId: NodeId | null) => {
    setPendingFrom(nodeId)
  }, [])

  const reset = useCallback(() => {
    setNodes([])
    setEdges([])
    setPendingFrom(null)
    setNextId(1)
  }, [])

  const createOnBackgroundClick = useCallback(
    (svgRef: React.RefObject<SVGSVGElement | null>, isDisabled: boolean) =>
      (e: React.MouseEvent<SVGSVGElement>) => {
        if (e.button !== 0) return
        if (isDisabled) return
        const svg = svgRef.current
        if (!svg) return
        const rect = svg.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        addNode(x, y)
      },
    [addNode]
  )

  const createOnBackgroundContextMenu = useCallback(
    () => (e: React.MouseEvent) => {
      e.preventDefault()
      setPending(null)
    },
    [setPending]
  )

  const createOnNodeContextMenu = (nodeId: NodeId, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (pendingFrom === null) {
      console.log(`[Edge] Selected node ${nodeId} as start`)
      setPending(nodeId)
    } else if (pendingFrom === nodeId) {
      console.log(`[Edge] Deselected node ${nodeId}`)
      setPending(null)
    } else {
      console.log(`[Edge] Creating/toggling edge between ${pendingFrom} and ${nodeId}`)
      toggleEdge(pendingFrom, nodeId)
      console.log(`[Edge] Cleared pending, edges:`, edges)
      setPending(null)
    }
  }
  const createOnNodeClick = useCallback(
    (
      mappingActive: boolean,
      mappingQueue: NodeId[],
      mappingIndex: number,
      mapping: Record<number, number>,
      setMapping: (m: Record<number, number>) => void,
      setMappingIndex: (i: number) => void,
      setMappingActive: (a: boolean) => void
    ) =>
      (nodeId: NodeId, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!mappingActive) return
        const lhsId = mappingQueue[mappingIndex]
        if (lhsId == null) return
        const used = new Set(Object.values(mapping))
        if (used.has(nodeId)) return
        setMapping({ ...mapping, [lhsId]: nodeId })
        const nextIdx = mappingIndex + 1
        if (nextIdx >= mappingQueue.length) {
          setMappingIndex(nextIdx)
          setMappingActive(false)
        } else {
          setMappingIndex(nextIdx)
        }
      },
    []
  )

  return {
    nodes,
    edges,
    pendingFrom,
    nextId,
    addNode,
    addEdge,
    removeNode,
    removeEdge,
    toggleEdge,
    setPending,
    reset,
    setNodes,
    setEdges,
    createOnBackgroundClick,
    createOnBackgroundContextMenu,
    createOnNodeContextMenu,
    createOnNodeClick,
  }
}

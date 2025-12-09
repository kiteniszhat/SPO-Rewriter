import { useCallback, useMemo, useRef, useState } from 'react'

type NodeId = number

type GraphNode = {
  id: NodeId
  x: number
  y: number
}

type GraphEdge = {
  source: NodeId
  target: NodeId
}

export default function GraphEditor() {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [pendingFrom, setPendingFrom] = useState<NodeId | null>(null)
  const [nextId, setNextId] = useState<NodeId>(1)

  const svgRef = useRef<SVGSVGElement | null>(null)
  // LHS graph state (right-top panel)
  const [nodesLHS, setNodesLHS] = useState<GraphNode[]>([])
  const [edgesLHS, setEdgesLHS] = useState<GraphEdge[]>([])
  const [pendingFromLHS, setPendingFromLHS] = useState<NodeId | null>(null)
  const [nextIdLHS, setNextIdLHS] = useState<NodeId>(1)
  const svgLHSRef = useRef<SVGSVGElement | null>(null)

  // Mapping LHS -> Input
  const [mappingActive, setMappingActive] = useState(false)
  const [mappingQueue, setMappingQueue] = useState<NodeId[]>([])
  const [mappingIndex, setMappingIndex] = useState(0)
  const [mapping, setMapping] = useState<Record<number, number>>({})
  // RHS graph state (bottom-right panel)
  const [nodesRHS, setNodesRHS] = useState<GraphNode[]>([])
  const [edgesRHS, setEdgesRHS] = useState<GraphEdge[]>([])
  const [pendingFromRHS, setPendingFromRHS] = useState<NodeId | null>(null)
  const [nextIdRHS, setNextIdRHS] = useState<NodeId>(1)
  const svgRHSRef = useRef<SVGSVGElement | null>(null)
  // Mapping RHS -> LHS
  const [mappingActiveRHS, setMappingActiveRHS] = useState(false)
  const [mappingQueueRHS, setMappingQueueRHS] = useState<NodeId[]>([])
  const [mappingIndexRHS, setMappingIndexRHS] = useState(0)
  const [mappingRhsToLhs, setMappingRhsToLhs] = useState<Record<number, number>>({})
  // Calculated graph (bottom-left render)
  const [calcNodes, setCalcNodes] = useState<GraphNode[]>([])
  const [calcEdges, setCalcEdges] = useState<GraphEdge[]>([])

  const onBackgroundClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // Left click adds a node at mouse position
      if (e.button !== 0) return
      if (mappingActive) return
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      setNodes((prev) => [...prev, { id: nextId, x, y }])
      setNextId((id) => id + 1)
    },
    [nextId, mappingActive]
  )

  const onBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    // Prevent default context menu and clear selection if any
    e.preventDefault()
    setPendingFrom(null)
  }, [])

  const connectNodes = useCallback((a: NodeId, b: NodeId) => {
    if (a === b) return
    setEdges((prev) => {
      const exists = prev.some(
        (ed) => (ed.source === a && ed.target === b) || (ed.source === b && ed.target === a)
      )
      if (exists) return prev
      return [...prev, { source: a, target: b }]
    })
  }, [])

  const onNodeContextMenu = useCallback(
    (nodeId: NodeId, e: React.MouseEvent) => {
      // Right click selects first node or completes an edge to second node
      e.preventDefault()
      e.stopPropagation()
      if (mappingActive) return
      setPendingFrom((from) => {
        if (from == null) return nodeId
        if (from === nodeId) return null // toggle off
        connectNodes(from, nodeId)
        return null
      })
    },
    [connectNodes, mappingActive]
  )
  const onInputNodeClick = useCallback(
    (nodeId: NodeId, e: React.MouseEvent) => {
      // Prevent background click; handle mapping selection if active
      e.stopPropagation()
      if (!mappingActive) return
      const lhsId = mappingQueue[mappingIndex]
      if (lhsId == null) return
      const used = new Set(Object.values(mapping))
      if (used.has(nodeId)) return
      setMapping((prev) => ({ ...prev, [lhsId]: nodeId }))
      const nextIdx = mappingIndex + 1
      if (nextIdx >= mappingQueue.length) {
        setMappingIndex(nextIdx)
        setMappingActive(false)
      } else {
        setMappingIndex(nextIdx)
      }
    },
    [mappingActive, mappingIndex, mappingQueue, mapping]
  )

  // LHS handlers
  const onLHSBackgroundClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return
      const svg = svgLHSRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setNodesLHS((prev) => [...prev, { id: nextIdLHS, x, y }])
      setNextIdLHS((id) => id + 1)
    },
    [nextIdLHS]
  )
  const onLHSBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setPendingFromLHS(null)
  }, [])
  const connectNodesLHS = useCallback((a: NodeId, b: NodeId) => {
    if (a === b) return
    setEdgesLHS((prev) => {
      const exists = prev.some(
        (ed) => (ed.source === a && ed.target === b) || (ed.source === b && ed.target === a)
      )
      if (exists) return prev
      return [...prev, { source: a, target: b }]
    })
  }, [])
  const onLHSNodeContextMenu = useCallback(
    (nodeId: NodeId, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setPendingFromLHS((from) => {
        if (from == null) return nodeId
        if (from === nodeId) return null
        connectNodesLHS(from, nodeId)
        return null
      })
    },
    [connectNodesLHS]
  )

  const exportNodeLinkJSON = useCallback(() => {
    const data = {
      directed: false,
      multigraph: false,
      graph: {},
      nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      links: edges.map((e) => ({ source: e.source, target: e.target })),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'graph_node_link.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [nodes, edges])

  // Calculate: send graphs + mappings to backend and render returned graph in bottom-left
  const onCalculate = useCallback(async () => {
    const body = {
      mapping_lhs_to_input: mapping,
      mapping_rhs_to_lhs: mappingRhsToLhs,
      graph_input: {
        directed: false,
        multigraph: false,
        graph: {},
        nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        links: edges.map((e) => ({ source: e.source, target: e.target })),
      },
      graph_lhs: {
        directed: false,
        multigraph: false,
        graph: {},
        nodes: nodesLHS.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        links: edgesLHS.map((e) => ({ source: e.source, target: e.target })),
      },
      graph_rhs: {
        directed: false,
        multigraph: false,
        graph: {},
        nodes: nodesRHS.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        links: edgesRHS.map((e) => ({ source: e.source, target: e.target })),
      },
    }
    try {
      const res = await fetch('http://localhost:8000/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const rNodes = Array.isArray(data.nodes) ? data.nodes : []
      const rLinks = Array.isArray(data.links) ? data.links : []
      setCalcNodes(rNodes.map((n: any) => ({ id: Number(n.id ?? n), x: n.x ?? 0, y: n.y ?? 0 })))
      setCalcEdges(rLinks.map((l: any) => ({ source: Number(l.source), target: Number(l.target) })))
    } catch (err) {
      console.error('Calculate failed', err)
    }
  }, [mapping, mappingRhsToLhs, nodes, edges, nodesLHS, edgesLHS, nodesRHS, edgesRHS])

  const clearGraph = useCallback(() => {
    setNodes([])
    setEdges([])
    setPendingFrom(null)
    setNextId(1)
  }, [])

  const clearLHS = useCallback(() => {
    setNodesLHS([])
    setEdgesLHS([])
    setPendingFromLHS(null)
    setNextIdLHS(1)
  }, [])

  const startMapping = useCallback(() => {
    if (nodesLHS.length === 0 || nodes.length === 0) return
    // ensure RHS mapping is not active at the same time
    setMappingActiveRHS(false)
    setMappingQueueRHS([])
    setMappingIndexRHS(0)
    setMapping({})
    const queue = [...nodesLHS].sort((a, b) => a.id - b.id).map((n) => n.id)
    setMappingQueue(queue)
    setMappingIndex(0)
    setMappingActive(true)
  }, [nodesLHS, nodes])

  // LHS->Input mapping helpers can be re-added for controls as needed

  const pendingNode = useMemo(() => pendingFrom, [pendingFrom])
  const pendingNodeLHS = useMemo(() => pendingFromLHS, [pendingFromLHS])
  const currentLHSId = mappingActive ? mappingQueue[mappingIndex] : undefined
  const usedInputIds = useMemo(() => new Set(Object.values(mapping)), [mapping])
  const usedLhsIdsFromRhs = useMemo(() => new Set(Object.values(mappingRhsToLhs)), [mappingRhsToLhs])
  const currentRHSId = mappingActiveRHS ? mappingQueueRHS[mappingIndexRHS] : undefined
  const pendingNodeRHS = useMemo(() => pendingFromRHS, [pendingFromRHS])

  return (
    <div className="graph-editor-root" onContextMenu={(e) => e.preventDefault()}>
      <div
        className="stage"
        style={{
          display: 'grid',
          gridTemplateColumns: '7fr 3fr',
          gridTemplateRows: 'minmax(280px, 1fr) auto',
          gap: 8,
          height: '100%',
        }}
      >
        {/* Top-left: Input graph */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong>Input</strong>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <svg
              ref={svgRef}
              className="graph-canvas"
              onClick={onBackgroundClick}
              onContextMenu={onBackgroundContextMenu}
              style={{ width: '100%', height: '100%', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, display: 'block' }}
            >
              <g>
                {edges.map((e, idx) => {
                  const a = nodes.find((n) => n.id === e.source)
                  const b = nodes.find((n) => n.id === e.target)
                  if (!a || !b) return null
                  return (
                    <line
                      key={`edge-${idx}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#555"
                      strokeWidth={2}
                    />
                  )
                })}
              </g>
              <g>
                {nodes.map((n) => (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    onContextMenu={(e) => onNodeContextMenu(n.id, e)}
                    onClick={(e) => onInputNodeClick(n.id, e)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      r={14}
                      fill={usedInputIds.has(n.id) ? '#a7f3d0' : pendingNode === n.id ? '#ffd24d' : '#69c'}
                      stroke={usedInputIds.has(n.id) ? '#059669' : pendingNode === n.id ? '#cc9a00' : '#2a5e83'}
                      strokeWidth={2}
                    />
                    <text
                      y={4}
                      textAnchor="middle"
                      fontSize={12}
                      fill="#102a43"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {n.id}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </div>

        {/* Top-right: LHS graph */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong>LHS</strong>
            <button onClick={startMapping} disabled={nodesLHS.length === 0 || nodes.length === 0 || mappingActive}>
              Proceed
            </button>
            <button onClick={clearLHS} disabled={mappingActive}>Clear</button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
              {mappingActive ? `map: ${mappingIndex + 1}/${mappingQueue.length}` : ''}
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <svg
              ref={svgLHSRef}
              onClick={onLHSBackgroundClick}
              onContextMenu={onLHSBackgroundContextMenu}
              style={{ width: '100%', height: '100%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, display: 'block' }}
            >
              <g>
                {edgesLHS.map((e, idx) => {
                  const a = nodesLHS.find((n) => n.id === e.source)
                  const b = nodesLHS.find((n) => n.id === e.target)
                  if (!a || !b) return null
                  return (
                    <line
                      key={`edge-lhs-${idx}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#555"
                      strokeWidth={2}
                    />
                  )
                })}
              </g>
              <g>
                {nodesLHS.map((n) => {
                  const isCurrent = mappingActive && currentLHSId === n.id
                  const isPending = !mappingActive && pendingNodeLHS === n.id
                  const isUsedByRhs = usedLhsIdsFromRhs.has(n.id)
                  return (
                    <g
                      key={`lhs-${n.id}`}
                      transform={`translate(${n.x}, ${n.y})`}
                      onContextMenu={(e) => onLHSNodeContextMenu(n.id, e)}
                      onClick={(e) => {
                        e.stopPropagation()
                        // If RHS mapping is active, map current RHS -> this LHS node
                        if (!mappingActiveRHS) return
                        const rhsId = currentRHSId
                        if (rhsId == null) return
                        // avoid duplicate LHS targets
                        const used = new Set(Object.values(mappingRhsToLhs))
                        if (used.has(n.id)) return
                        setMappingRhsToLhs((prev) => ({ ...prev, [rhsId]: n.id }))
                        const nextIdx = mappingIndexRHS + 1
                        if (nextIdx >= mappingQueueRHS.length) {
                          setMappingIndexRHS(nextIdx)
                          setMappingActiveRHS(false)
                        } else {
                          setMappingIndexRHS(nextIdx)
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle
                        r={14}
                        fill={isCurrent || isPending ? '#ffd24d' : isUsedByRhs ? '#a7f3d0' : '#69c'}
                        stroke={isCurrent || isPending ? '#cc9a00' : isUsedByRhs ? '#059669' : '#2a5e83'}
                        strokeWidth={2}
                      />
                      <text
                        y={4}
                        textAnchor="middle"
                        fontSize={12}
                        fill="#102a43"
                        style={{ userSelect: 'none', pointerEvents: 'none' }}
                      >
                        {n.id}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
            {/* Optional small preview for LHS->Input mapping */}
            {Object.keys(mapping).length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>Mapping LHS → Input</div>
                <pre
                  style={{
                    maxHeight: 120,
                    overflow: 'auto',
                    fontSize: 12,
                    background: '#f3f4f6',
                    padding: 8,
                    borderRadius: 4,
                    border: '1px solid #e5e7eb',
                    margin: 0,
                  }}
                >
{JSON.stringify(mapping, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Bottom-left: Calculate button + Calculated graph preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={onCalculate}>Calculate</button>
            <button onClick={exportNodeLinkJSON}>Export Input JSON</button>
            <button onClick={clearGraph}>Clear Input</button>
            <div className="hint" style={{ marginLeft: 8 }}>
              Lewy klik: dodaj • Prawy klik: połącz
            </div>
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 6 }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Calculated</div>
            <svg
              style={{ width: '100%', height: 260, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 6, display: 'block' }}
            >
              <g>
                {calcEdges.map((e, idx) => {
                  const a = calcNodes.find((n) => n.id === e.source)
                  const b = calcNodes.find((n) => n.id === e.target)
                  if (!a || !b) return null
                  return (
                    <line
                      key={`edge-calc-${idx}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#6b7280"
                      strokeWidth={2}
                    />
                  )
                })}
              </g>
              <g>
                {calcNodes.map((n) => (
                  <g key={`calc-${n.id}`} transform={`translate(${n.x}, ${n.y})`}>
                    <circle r={12} fill="#93c5fd" stroke="#1d4ed8" strokeWidth={2} />
                    <text y={4} textAnchor="middle" fontSize={11} fill="#0f172a" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                      {n.id}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </div>

        {/* Bottom-right: RHS graph with mapping RHS -> LHS */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong>RHS</strong>
            <button
              onClick={() => {
                if (nodesRHS.length === 0 || nodesLHS.length === 0) return
                // ensure LHS->Input mapping is not active
                setMappingActive(false)
                setMappingQueue([])
                setMappingIndex(0)
                const queue = [...nodesRHS].sort((a, b) => a.id - b.id).map((n) => n.id)
                setMappingRhsToLhs({})
                setMappingQueueRHS(queue)
                setMappingIndexRHS(0)
                setMappingActiveRHS(true)
              }}
              disabled={nodesRHS.length === 0 || nodesLHS.length === 0 || mappingActiveRHS}
            >
              Proceed
            </button>
            <button
              onClick={() => {
                setNodesRHS([])
                setEdgesRHS([])
                setPendingFromRHS(null)
                setNextIdRHS(1)
              }}
              disabled={mappingActiveRHS}
            >
              Clear
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
              {mappingActiveRHS ? `map: ${mappingIndexRHS + 1}/${mappingQueueRHS.length}` : ''}
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <svg
              ref={svgRHSRef}
              onClick={(e) => {
                if (e.button !== 0) return
                const svg = svgRHSRef.current
                if (!svg) return
                const rect = svg.getBoundingClientRect()
                const x = e.clientX - rect.left
                const y = e.clientY - rect.top
                setNodesRHS((prev) => [...prev, { id: nextIdRHS, x, y }])
                setNextIdRHS((id) => id + 1)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setPendingFromRHS(null)
              }}
              style={{ width: '100%', height: '100%', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, display: 'block' }}
            >
              <g>
                {edgesRHS.map((e, idx) => {
                  const a = nodesRHS.find((n) => n.id === e.source)
                  const b = nodesRHS.find((n) => n.id === e.target)
                  if (!a || !b) return null
                  return (
                    <line
                      key={`edge-rhs-${idx}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#555"
                      strokeWidth={2}
                    />
                  )
                })}
              </g>
              <g>
                {nodesRHS.map((n) => (
                  <g
                    key={`rhs-${n.id}`}
                    transform={`translate(${n.x}, ${n.y})`}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setPendingFromRHS((from) => {
                        if (from == null) return n.id
                        if (from === n.id) return null
                        setEdgesRHS((prev) => {
                          const exists = prev.some(
                            (ed) => (ed.source === from && ed.target === n.id) || (ed.source === n.id && ed.target === from)
                          )
                          if (exists) return prev
                          return [...prev, { source: from, target: n.id }]
                        })
                        return null
                      })
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      r={14}
                      fill={mappingActiveRHS && currentRHSId === n.id ? '#ffd24d' : pendingNodeRHS === n.id ? '#ffd24d' : '#69c'}
                      stroke={mappingActiveRHS && currentRHSId === n.id ? '#cc9a00' : pendingNodeRHS === n.id ? '#cc9a00' : '#2a5e83'}
                      strokeWidth={2}
                    />
                    <text
                      y={4}
                      textAnchor="middle"
                      fontSize={12}
                      fill="#102a43"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {n.id}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
          <div style={{ marginTop: 6 }}>
            {mappingActiveRHS ? (
              <>
                <span style={{ color: '#5b21b6' }}>Wskaż odpowiednik w LHS dla RHS {currentRHSId}</span>
                <button
                  onClick={() => {
                    setMappingActiveRHS(false)
                    setMappingQueueRHS([])
                    setMappingIndexRHS(0)
                    setMappingRhsToLhs({})
                  }}
                  style={{ marginLeft: 8 }}
                >
                  Cancel
                </button>
              </>
            ) : Object.keys(mappingRhsToLhs).length > 0 ? (
              <>
                <span>Zmapowano {Object.keys(mappingRhsToLhs).length}/{nodesRHS.length}</span>
                <button onClick={async () => {
                  try { await navigator.clipboard.writeText(JSON.stringify(mappingRhsToLhs, null, 2)) } catch {}
                }} style={{ marginLeft: 8 }}>Copy mapping</button>
                <button onClick={() => { setMappingRhsToLhs({}); }} style={{ marginLeft: 8 }}>Reset</button>
              </>
            ) : (
              <span style={{ color: '#6b7280' }}>Kliknij Proceed, a potem wskaż węzły w LHS.</span>
            )}
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>Mapping RHS → LHS</div>
            <pre
              style={{
                maxHeight: 160,
                overflow: 'auto',
                fontSize: 12,
                background: '#f3f4f6',
                padding: 8,
                borderRadius: 4,
                border: '1px solid #e5e7eb',
                margin: 0,
              }}
            >
{JSON.stringify(mappingRhsToLhs, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

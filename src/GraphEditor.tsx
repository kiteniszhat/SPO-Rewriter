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

  const [showHelp, setShowHelp] = useState(false)

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

  const pendingNode = useMemo(() => pendingFrom, [pendingFrom])
  const pendingNodeLHS = useMemo(() => pendingFromLHS, [pendingFromLHS])
  const currentLHSId = mappingActive ? mappingQueue[mappingIndex] : undefined
  const usedInputIds = useMemo(() => new Set(Object.values(mapping)), [mapping])
  const usedLhsIdsFromRhs = useMemo(() => new Set(Object.values(mappingRhsToLhs)), [mappingRhsToLhs])
  const currentRHSId = mappingActiveRHS ? mappingQueueRHS[mappingIndexRHS] : undefined
  const pendingNodeRHS = useMemo(() => pendingFromRHS, [pendingFromRHS])

  return (
    <div className="graph-editor-root" onContextMenu={(e) => e.preventDefault()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-color)' }}>SPO Rewriter</h1>
        <button className="btn" onClick={() => setShowHelp(!showHelp)}>
          {showHelp ? 'Hide Help' : 'Show Help'}
        </button>
      </div>

      {showHelp && (
        <div style={{
          backgroundColor: 'var(--bg-secondary)',
          padding: '1rem',
          borderRadius: '0.5rem',
          marginBottom: '1rem',
          border: '1px solid var(--border-color)'
        }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent-color)' }}>Instructions</h3>
          <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-secondary)' }}>
            <li><strong>Left Click:</strong> Add a node.</li>
            <li><strong>Right Click:</strong> Select a node to start a connection (click another node to finish).</li>
            <li><strong>Workflow:</strong>
              <ol>
                <li>Draw the <strong>Input Graph</strong> (Top Left).</li>
                <li>Draw the <strong>LHS Graph</strong> (Top Right) - the pattern to find.</li>
                <li>Click <strong>Map LHS→Input</strong> to define where the pattern matches in the input.</li>
                <li>Draw the <strong>RHS Graph</strong> (Bottom Right) - the replacement pattern.</li>
                <li>Click <strong>Map RHS→LHS</strong> to define which nodes are preserved.</li>
                <li>Click <strong>Calculate</strong> to see the result (Bottom Left).</li>
              </ol>
            </li>
          </ul>
        </div>
      )}

      <div
        className="stage"
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: '1rem',
          height: '100%',
        }}
      >
        {/* Top-left: Input graph */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="panel-header">
            <span className="panel-title">Input Graph</span>
            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button className="btn" onClick={clearGraph}>Clear</button>
              <button className="btn" onClick={exportNodeLinkJSON}>Export JSON</button>
            </div>
          </div>
          <div className="graph-container">
            <svg
              ref={svgRef}
              className="graph-canvas"
              onClick={onBackgroundClick}
              onContextMenu={onBackgroundContextMenu}
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
                      stroke="var(--text-secondary)"
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
                      fill={usedInputIds.has(n.id) ? 'var(--node-mapped-fill)' : pendingNode === n.id ? 'var(--node-selected-fill)' : 'var(--node-fill)'}
                      stroke={usedInputIds.has(n.id) ? 'var(--node-mapped-stroke)' : pendingNode === n.id ? 'var(--node-selected-stroke)' : 'var(--node-stroke)'}
                      strokeWidth={2}
                    />
                    <text
                      y={4}
                      textAnchor="middle"
                      fontSize={12}
                      fill="#fff"
                      style={{ userSelect: 'none', pointerEvents: 'none', fontWeight: 600 }}
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
          <div className="panel-header">
            <span className="panel-title">LHS Pattern</span>
            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button
                className="btn btn-primary"
                onClick={startMapping}
                disabled={nodesLHS.length === 0 || nodes.length === 0 || mappingActive}
              >
                Map LHS→Input
              </button>
              <button className="btn" onClick={clearLHS} disabled={mappingActive}>Clear</button>
            </div>
          </div>
          <div style={{ marginBottom: '0.5rem', height: '1.5rem' }}>
            <span className="mapping-status">
              {mappingActive ? `Mapping node ${currentLHSId} (${mappingIndex + 1}/${mappingQueue.length})` : ''}
            </span>
          </div>
          <div className="graph-container">
            <svg
              ref={svgLHSRef}
              className="graph-canvas"
              onClick={onLHSBackgroundClick}
              onContextMenu={onLHSBackgroundContextMenu}
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
                      stroke="var(--text-secondary)"
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
                        // If RHS mapping is active, map current RHS → this LHS node
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
                        fill={isCurrent || isPending ? 'var(--node-selected-fill)' : isUsedByRhs ? 'var(--node-mapped-fill)' : 'var(--node-fill)'}
                        stroke={isCurrent || isPending ? 'var(--node-selected-stroke)' : isUsedByRhs ? 'var(--node-mapped-stroke)' : 'var(--node-stroke)'}
                        strokeWidth={2}
                      />
                      <text
                        y={4}
                        textAnchor="middle"
                        fontSize={12}
                        fill="#fff"
                        style={{ userSelect: 'none', pointerEvents: 'none', fontWeight: 600 }}
                      >
                        {n.id}
                      </text>
                    </g>
                  )
                })}
              </g>
            </svg>
          </div>
        </div>

        {/* Bottom-left: Calculated Result */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="panel-header">
            <span className="panel-title">Result</span>
            <button className="btn btn-primary" onClick={onCalculate} style={{ marginLeft: 'auto' }}>
              Calculate 
            </button>
          </div>
          <div className="graph-container">
            {(() => {
              const padding = 24
              const width = 600 // virtual canvas width for viewBox
              const height = 260 // container height
              const xs = calcNodes.map((n) => n.x)
              const ys = calcNodes.map((n) => n.y)
              const minX = xs.length ? Math.min(...xs) : 0
              const maxX = xs.length ? Math.max(...xs) : 1
              const minY = ys.length ? Math.min(...ys) : 0
              const maxY = ys.length ? Math.max(...ys) : 1
              const contentW = Math.max(1, maxX - minX)
              const contentH = Math.max(1, maxY - minY)
              const scaleX = (width - padding * 2) / contentW
              const scaleY = (height - padding * 2) / contentH
              const scale = Math.max(0.1, Math.min(scaleX, scaleY))
              const translateX = padding - minX * scale
              const translateY = padding - minY * scale
              return (
                <svg
                  className="graph-canvas"
                  viewBox={`0 0 ${width} ${height}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <g transform={`translate(${translateX}, ${translateY}) scale(${scale})`}>
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
                            stroke="var(--text-secondary)"
                            strokeWidth={2 / scale}
                          />
                        )
                      })}
                    </g>
                    <g>
                      {calcNodes.map((n) => (
                        <g key={`calc-${n.id}`} transform={`translate(${n.x}, ${n.y})`}>
                          <circle r={12 / scale} fill="var(--node-fill)" stroke="var(--node-stroke)" strokeWidth={2 / scale} />
                          <text y={4 / scale} textAnchor="middle" fontSize={11 / scale} fill="#fff" style={{ userSelect: 'none', pointerEvents: 'none', fontWeight: 600 }}>
                            {n.id}
                          </text>
                        </g>
                      ))}
                    </g>
                  </g>
                </svg>
              )
            })()}
          </div>
        </div>

        {/* Bottom-right: RHS graph with mapping RHS → LHS */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="panel-header">
            <span className="panel-title">RHS Replacement</span>
            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (nodesRHS.length === 0 || nodesLHS.length === 0) return
                  // ensure LHS→Input mapping is not active
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
                Map RHS→LHS
              </button>
              <button
                className="btn"
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
            </div>
          </div>
          <div style={{ marginBottom: '0.5rem', height: '1.5rem' }}>
            {mappingActiveRHS ? (
              <span className="mapping-status">
                Map RHS node {currentRHSId} to LHS node...
                <button
                  className="btn"
                  style={{ marginLeft: '0.5rem', padding: '0.1rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => {
                    setMappingActiveRHS(false)
                    setMappingQueueRHS([])
                    setMappingIndexRHS(0)
                    setMappingRhsToLhs({})
                  }}
                >
                  Cancel
                </button>
              </span>
            ) : Object.keys(mappingRhsToLhs).length > 0 ? (
              <span style={{ color: 'var(--success-color)' }}>
                Mapped {Object.keys(mappingRhsToLhs).length}/{nodesRHS.length} nodes
                <button
                  className="btn"
                  style={{ marginLeft: '0.5rem', padding: '0.1rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => { setMappingRhsToLhs({}); }}
                >
                  Reset
                </button>
              </span>
            ) : (
              <span className="hint-text">Draw RHS, then map to LHS.</span>
            )}
          </div>
          <div className="graph-container">
            <svg
              ref={svgRHSRef}
              className="graph-canvas"
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
                      stroke="var(--text-secondary)"
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
                      fill={mappingActiveRHS && currentRHSId === n.id ? 'var(--node-selected-fill)' : pendingNodeRHS === n.id ? 'var(--node-selected-fill)' : 'var(--node-fill)'}
                      stroke={mappingActiveRHS && currentRHSId === n.id ? 'var(--node-selected-stroke)' : pendingNodeRHS === n.id ? 'var(--node-selected-stroke)' : 'var(--node-stroke)'}
                      strokeWidth={2}
                    />
                    <text
                      y={4}
                      textAnchor="middle"
                      fontSize={12}
                      fill="#fff"
                      style={{ userSelect: 'none', pointerEvents: 'none', fontWeight: 600 }}
                    >
                      {n.id}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useMemo, useRef, useState } from 'react'
import type {NodeId,GraphNode,GraphEdge} from "./Types"
import { useGraphState } from './hooks/useGraphState'


export default function GraphEditor() {
  const inputState = useGraphState()
  const lhsState = useGraphState()
  const rhsState = useGraphState()

  const svgRef = useRef<SVGSVGElement | null>(null)
  const svgLHSRef = useRef<SVGSVGElement | null>(null)
  const svgRHSRef = useRef<SVGSVGElement | null>(null)

  // Mapping LHS -> Input
  const [mappingActive, setMappingActive] = useState(false)
  const [mappingQueue, setMappingQueue] = useState<NodeId[]>([])
  const [mappingIndex, setMappingIndex] = useState(0)
  const [mapping, setMapping] = useState<Record<number, number>>({})
  // Mapping RHS -> LHS
  const [mappingActiveRHS, setMappingActiveRHS] = useState(false)
  const [mappingQueueRHS, setMappingQueueRHS] = useState<NodeId[]>([])
  const [mappingIndexRHS, setMappingIndexRHS] = useState(0)
  const [mappingRhsToLhs, setMappingRhsToLhs] = useState<Record<number, number>>({})
  const [calcNodes, setCalcNodes] = useState<GraphNode[]>([])
  const [calcEdges, setCalcEdges] = useState<GraphEdge[]>([])

  const [showHelp, setShowHelp] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Input graph handlers
  const onBackgroundClick = inputState.createOnBackgroundClick(svgRef, mappingActive)
  const onBackgroundContextMenu = inputState.createOnBackgroundContextMenu()

  
  const onInputNodeClick = inputState.createOnNodeClick(
    mappingActive,
    mappingQueue,
    mappingIndex,
    mapping,
    setMapping,
    setMappingIndex,
    setMappingActive
  )

  // LHS graph handlers
  const onLHSBackgroundClick = lhsState.createOnBackgroundClick(svgLHSRef, false)
  const onLHSBackgroundContextMenu = lhsState.createOnBackgroundContextMenu()


  const exportNodeLinkJSON = useCallback(() => {
    const data = {
      graph: {},
      nodes: inputState.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      links: inputState.edges.map((e) => ({ source: e.source, target: e.target })),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'graph_node_link.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [inputState.nodes, inputState.edges])

  // Calculate: send graphs + mappings to backend and render returned graph in bottom-left
  const onCalculate = useCallback(async () => {
    setError(null)
    const body = {
      mapping_lhs_to_input: mapping,
      mapping_rhs_to_lhs: mappingRhsToLhs,
      graph_input: {
        graph: {},
        nodes: inputState.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        links: inputState.edges.map((e) => ({ source: e.source, target: e.target })),
      },
      graph_lhs: {
        graph: {},
        nodes: lhsState.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        links: lhsState.edges.map((e) => ({ source: e.source, target: e.target })),
      },
      graph_rhs: {
        graph: {},
        nodes: rhsState.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        links: rhsState.edges.map((e) => ({ source: e.source, target: e.target })),
      },
    }
    try {
      const res = await fetch('http://localhost:8000/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`
        try {
          const errData = await res.json()
          if (errData && errData.detail) {
            errorMsg = errData.detail
          }
        } catch (e) {
        }
        throw new Error(errorMsg)
      }
      const data = await res.json()
      const rNodes = Array.isArray(data.nodes) ? data.nodes : []
      const rLinks = Array.isArray(data.links) ? data.links : []
      setCalcNodes(rNodes.map((n: any) => ({ id: Number(n.id ?? n), x: n.x ?? 0, y: n.y ?? 0 })))
      setCalcEdges(rLinks.map((l: any) => ({ source: Number(l.source), target: Number(l.target) })))
    } catch (err: any) {
      console.error('Calculate failed', err)
      setError(err.message || 'Unknown error occurred')
    }
  }, [mapping, mappingRhsToLhs, inputState.nodes, inputState.edges, lhsState.nodes, lhsState.edges, rhsState.nodes, rhsState.edges])



 
  const startMapping = useCallback(() => {
    if (lhsState.nodes.length === 0 || inputState.nodes.length === 0) return
    // ensure RHS mapping is not active at the same time
    setMappingActiveRHS(false)
    setMappingQueueRHS([])
    setMappingIndexRHS(0)
    setMapping({})
    const queue = [...lhsState.nodes].sort((a, b) => a.id - b.id).map((n) => n.id)
    setMappingQueue(queue)
    setMappingIndex(0)
    setMappingActive(true)
  }, [lhsState.nodes, inputState.nodes])

  const pendingNode = useMemo(() => inputState.pendingFrom, [inputState.pendingFrom])
  const pendingNodeLHS = useMemo(() => lhsState.pendingFrom, [lhsState.pendingFrom])
  const currentLHSId = mappingActive ? mappingQueue[mappingIndex] : undefined
  const usedInputIds = useMemo(() => new Set(Object.values(mapping)), [mapping])
  const usedLhsIdsFromRhs = useMemo(() => new Set(Object.values(mappingRhsToLhs)), [mappingRhsToLhs])
  const currentRHSId = mappingActiveRHS ? mappingQueueRHS[mappingIndexRHS] : undefined
  const pendingNodeRHS = useMemo(() => rhsState.pendingFrom, [rhsState.pendingFrom])

  // Move Result as Input: Replace input graph with result and clear everything else
  const moveResultAsInput = useCallback(() => {
    if (calcNodes.length === 0) return

    // 1. Calculate boundaries and scale to fit Input graph area
    const xs = calcNodes.map((n) => n.x)
    const ys = calcNodes.map((n) => n.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    let contentW = maxX - minX
    let contentH = maxY - minY
    if (contentW === 0) contentW = 1
    if (contentH === 0) contentH = 1

    // Get input SVG dimensions
    let svgW = 600
    let svgH = 400
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect()
      svgW = rect.width
      svgH = rect.height
    }

    const padding = 40
    const availableW = Math.max(1, svgW - padding * 2)
    const availableH = Math.max(1, svgH - padding * 2)

    const scaleX = availableW / contentW
    const scaleY = availableH / contentH
    // Use the smaller scale to fit entirely, but don't blow up tiny graphs too much (optional: remove Math.min(..., 1) if we always want to fill)
    // User requested "map to size of input board", suggesting we should fit it.
    const scale = Math.min(scaleX, scaleY)

    const newNodes = calcNodes.map((n) => ({
      id: n.id,
      x: padding + (n.x - minX) * scale,
      y: padding + (n.y - minY) * scale,
    }))

    // 2. Set Input Graph from Result (Scaled)
    inputState.setNodes(newNodes)
    inputState.setEdges(calcEdges)
    inputState.setPending(null)

    // 3. Clear LHS
    lhsState.reset()

    // 4. Clear RHS
    rhsState.reset()

    // 5. Clear Mappings
    setMappingActive(false)
    setMappingQueue([])
    setMappingIndex(0)
    setMapping({})

    setMappingActiveRHS(false)
    setMappingQueueRHS([])
    setMappingIndexRHS(0)
    setMappingRhsToLhs({})

    // 6. Clear Result
    setCalcNodes([])
    setCalcEdges([])
    // Clear error
    setError(null)
  }, [calcNodes, calcEdges, inputState, lhsState, rhsState])

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
                <li>Click <strong>Move Result as Input</strong> to use the result as the next input and continue rewriting.</li>
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
              <button className="btn" onClick={ inputState.reset}>Clear</button>
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
                {inputState.edges.map((e, idx) => {
                  const a = inputState.nodes.find((n) => n.id === e.source)
                  const b = inputState.nodes.find((n) => n.id === e.target)
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
                {inputState.nodes.map((n) => (
                  <g
                    key={n.id}
                    transform={`translate(${n.x}, ${n.y})`}
                    onContextMenu={(e) => inputState.createOnNodeContextMenu(n.id, e)}
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
                disabled={lhsState.nodes.length === 0 || inputState.nodes.length === 0 || mappingActive}
              >
                Map LHS→Input
              </button>
              <button className="btn" onClick={ lhsState.reset} disabled={mappingActive}>Clear</button>
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
                {lhsState.edges.map((e, idx) => {
                  const a = lhsState.nodes.find((n) => n.id === e.source)
                  const b = lhsState.nodes.find((n) => n.id === e.target)
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
                {lhsState.nodes.map((n) => {
                  const isCurrent = mappingActive && currentLHSId === n.id
                  const isPending = !mappingActive && pendingNodeLHS === n.id
                  const isUsedByRhs = usedLhsIdsFromRhs.has(n.id)
                  return (
                    <g
                      key={`lhs-${n.id}`}
                      transform={`translate(${n.x}, ${n.y})`}
                      onContextMenu={(e) => lhsState.createOnNodeContextMenu(n.id, e)}
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
            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button
                className="btn"
                onClick={moveResultAsInput}
                disabled={calcNodes.length === 0}
                title="Use this result as the new Input Graph and clear patterns"
              >
                Move Result as Input
              </button>
              <button className="btn btn-primary" onClick={onCalculate}>
                Calculate Rewrite
              </button>
            </div>
          </div>
          {error && (
            <div style={{
              backgroundColor: 'rgba(255, 0, 0, 0.1)',
              border: '1px solid var(--error-color, red)',
              color: 'var(--error-color, red)',
              padding: '0.5rem',
              borderRadius: '0.25rem',
              marginBottom: '0.5rem',
              fontSize: '0.9rem'
            }}>
              <strong>Error:</strong> {error}
            </div>
          )}
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
                  if (rhsState.nodes.length === 0 || lhsState.nodes.length === 0) return
                  // ensure LHS→Input mapping is not active
                  setMappingActive(false)
                  setMappingQueue([])
                  setMappingIndex(0)
                  const queue = [...rhsState.nodes].sort((a, b) => a.id - b.id).map((n) => n.id)
                  setMappingRhsToLhs({})
                  setMappingQueueRHS(queue)
                  setMappingIndexRHS(0)
                  setMappingActiveRHS(true)
                }}
                disabled={rhsState.nodes.length === 0 || lhsState.nodes.length === 0 || mappingActiveRHS}
              >
                Map RHS→LHS
              </button>
              <button
                className="btn"
                onClick={() => {
                  rhsState.reset()
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
                Mapped {Object.keys(mappingRhsToLhs).length}/{rhsState.nodes.length} nodes
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
                rhsState.addNode(x, y)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                rhsState.setPending(null)
              }}
            >
              <g>
                {rhsState.edges.map((e, idx) => {
                  const a = rhsState.nodes.find((n) => n.id === e.source)
                  const b = rhsState.nodes.find((n) => n.id === e.target)
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
                {rhsState.nodes.map((n) => (
                  <g
                    key={`rhs-${n.id}`}
                    transform={`translate(${n.x}, ${n.y})`}
                    onContextMenu={(e) => rhsState.createOnNodeContextMenu(n.id, e)}
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

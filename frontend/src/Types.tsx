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
export type {NodeId,GraphNode,GraphEdge}
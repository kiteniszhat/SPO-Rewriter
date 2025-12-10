from typing import Dict, List, Optional, Union
import json
import logging
import math
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import networkx as nx
from networkx.readwrite import json_graph
from collections import deque

NodeId = Union[int, str]


class Node(BaseModel):
    id: NodeId
    x: Optional[float] = None
    y: Optional[float] = None


class Link(BaseModel):
    source: NodeId
    target: NodeId


class NodeLinkGraph(BaseModel):
    directed: Optional[bool] = False
    multigraph: Optional[bool] = False
    graph: Dict = Field(default_factory=dict)
    nodes: List[Node] = Field(default_factory=list)
    links: List[Link] = Field(default_factory=list)

    def to_networkx(self) -> nx.Graph:
        data = {
            "directed": self.directed,
            "multigraph": self.multigraph,
            "graph": self.graph,
            "nodes": [n.model_dump() for n in self.nodes],
            "links": [e.model_dump() for e in self.links],
        }
        return json_graph.node_link_graph(data, directed=self.directed, multigraph=self.multigraph)


class CalculateRequest(BaseModel):
    mapping_lhs_to_input: Dict[NodeId, NodeId] = Field(default_factory=dict)
    mapping_rhs_to_lhs: Dict[NodeId, NodeId] = Field(default_factory=dict)
    graph_input: NodeLinkGraph
    graph_lhs: NodeLinkGraph
    graph_rhs: NodeLinkGraph


class CalculateResponseGraph(NodeLinkGraph):
    pass


app = FastAPI(title="Graph Calculate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logger = logging.getLogger("spo-rewriter")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

def _norm_nodeid(n):
    # keep ints as-is, convert numeric strings to int, leave other strings unchanged
    if isinstance(n, int):
        return n
    if isinstance(n, str):
        try:
            return int(n)
        except ValueError:
            return n
    return n

@app.post("/calculate", response_model=CalculateResponseGraph)
def calculate(req: CalculateRequest):
    # Log request summary
    try:
        logger.info(
            "Request: input nodes=%d edges=%d | lhs nodes=%d edges=%d | rhs nodes=%d edges=%d",
            len(req.graph_input.nodes), len(req.graph_input.links),
            len(req.graph_lhs.nodes), len(req.graph_lhs.links),
            len(req.graph_rhs.nodes), len(req.graph_rhs.links),
        )
    except Exception as e:
        logger.warning("Failed to log request summary: %s", e)

    G_in  = req.graph_input.to_networkx()
    G_lhs = req.graph_lhs.to_networkx()
    G_rhs = req.graph_rhs.to_networkx()

    # normalize mappings coming from JSON (keys are usually strings)
    lhs_to_input = { _norm_nodeid(k): _norm_nodeid(v) for k, v in req.mapping_lhs_to_input.items() }
    rhs_to_lhs   = { _norm_nodeid(k): _norm_nodeid(v) for k, v in req.mapping_rhs_to_lhs.items() }
    
    # Reverse map: LHS → list of RHS nodes that map to it
    lhs_from_rhs = {}
    for rhs_id, lhs_id in rhs_to_lhs.items():
        lhs_from_rhs.setdefault(lhs_id, []).append(rhs_id)

    # Create IDs for new nodes
    try:
        max_input_id = max(int(n) for n in G_in.nodes)
    except Exception:
        max_input_id = 0
    next_new_id = max_input_id + 1

    rhs_new_to_input = {}   # RHS-id → created input-id
    visited_rhs = set()     # Track nodes processed via preservation or BFS
    
    created_nodes_count = 0
    removed_nodes_count = 0
    added_edges_count = 0

    # --- Helper functions -----------------------------------------------------

    def ensure_edge(u, v):
        """Add edge if missing (handles directed/undirected)."""
        if G_in.is_directed():
            if not G_in.has_edge(u, v):
                G_in.add_edge(u, v)
                return True
        else:
            if not G_in.has_edge(u, v) and not G_in.has_edge(v, u):
                G_in.add_edge(u, v)
                return True
        return False

    def get_pos(graph, node_id):
        """Helper to get x, y safely."""
        attrs = graph.nodes.get(node_id, {})
        return float(attrs.get("x", 0.0)), float(attrs.get("y", 0.0))

    def create_rhs_only_node(rhs_id, rhs_src, input_src):
        """
        Create a new Input graph node corresponding to an RHS neighbor
        that does not map to LHS.
        rhs_id: the new node we are creating
        rhs_src: the neighbor in RHS that led us here
        input_src: the corresponding node in Input for rhs_src
        """
        nonlocal next_new_id
        nonlocal created_nodes_count
        
        if rhs_id in rhs_new_to_input:
            return rhs_new_to_input[rhs_id]
        
        # Position logic:
        # We want the vector (rhs_src -> rhs_id) to be applied to input_src.
        
        # 1. Get position of input anchor
        src_x, src_y = get_pos(G_in, input_src)
        
        # 2. Get vector in RHS
        rhs_src_x, rhs_src_y = get_pos(G_rhs, rhs_src)
        rhs_target_x, rhs_target_y = get_pos(G_rhs, rhs_id)
        
        dx = rhs_target_x - rhs_src_x
        dy = rhs_target_y - rhs_src_y
        
        # 3. Apply vector
        new_x = src_x + dx
        new_y = src_y + dy
        
        new_id = next_new_id
        next_new_id += 1
        created_nodes_count += 1
        
        G_in.add_node(new_id, x=new_x, y=new_y)
        rhs_new_to_input[rhs_id] = new_id
        
        logger.info(
            "Created input node %s from RHS %s (neighbor of %s) at (%.3f, %.3f)",
            new_id, rhs_id, rhs_src, new_x, new_y,
        )
        return new_id

    # --- Main logic: Preservation & BFS Expansion ----------------------------

    for lhs_id in list(G_lhs.nodes):
        input_id = lhs_to_input.get(lhs_id)
        if input_id is None:
            continue  # unmapped LHS is ignored

        rhs_list = lhs_from_rhs.get(lhs_id, [])
        if not rhs_list:
            if input_id in G_in:
                G_in.remove_node(input_id)   # delete non-preserved node
                removed_nodes_count += 1
                logger.info("Removed input node %s (no RHS counterpart)", input_id)
            continue

        # Node is preserved → expand frontier over RHS graph using BFS
        for rhs_start in rhs_list:

            if rhs_start not in G_rhs:
                continue
            
            # This RHS node is visited (it maps to an existing Input node)
            visited_rhs.add(rhs_start)

            # BFS queue holds (rhs_current, input_current_anchor)
            queue = deque()
            queue.append((rhs_start, input_id))
            
            while queue:
                rhs_cur, input_cur = queue.popleft()

                # neighbors in RHS for expansion
                if G_rhs.is_directed():
                    neighbors_iter = G_rhs.successors(rhs_cur)
                else:
                    neighbors_iter = G_rhs.neighbors(rhs_cur)

                for rhs_nbr in neighbors_iter:
                    lhs_nbr = rhs_to_lhs.get(rhs_nbr)

                    if lhs_nbr is None:
                        # RHS-only neighbor ⇒ create new input node relative to current anchor
                        # Only create/traverse if not already visited
                        if rhs_nbr not in visited_rhs:
                            input_nbr = create_rhs_only_node(rhs_nbr, rhs_cur, input_cur)
                            visited_rhs.add(rhs_nbr)
                            if ensure_edge(input_cur, input_nbr):
                                added_edges_count += 1
                            queue.append((rhs_nbr, input_nbr))
                        else:
                            # Already created via another path, just ensure edge
                            input_nbr = rhs_new_to_input.get(rhs_nbr)
                            # Or it might be a preserved node visited from "the other side"?
                            if input_nbr is None:
                                # It must be a preserved node then
                                lhs_of_visited = rhs_to_lhs.get(rhs_nbr)
                                if lhs_of_visited:
                                    input_nbr = lhs_to_input.get(lhs_of_visited)
                            
                            if input_nbr is not None:
                                if ensure_edge(input_cur, input_nbr):
                                    added_edges_count += 1
                        continue

                    # LHS → Input mapping exists (Preserved Node)
                    input_nbr = lhs_to_input.get(lhs_nbr)
                    if input_nbr is None:
                        continue

                    # If neighbor is preserved node, just link and mark visited
                    # (We generally don't BFS *through* preserved nodes to find *other* new nodes 
                    # unless we want to traverse the whole graph, but basic SPO often implies 
                    # expansion from boundary. Here we allow full traversal.)
                    visited_rhs.add(rhs_nbr)
                    if ensure_edge(input_cur, input_nbr):
                        added_edges_count += 1
                        logger.info("Added edge %s -> %s (mapped neighbor)", input_cur, input_nbr)

    # --- Handle Orphaned RHS Nodes -------------------------------------------
    # These are nodes that were not reached by BFS because they are disconnected
    # from the preserved nodes in the RHS graph structure.
    # We place them relative to the NEAREST preserved node (anchor) in RHS.

    # 1. Collect potential anchors (RHS nodes that have Input equivalents)
    anchors = []
    for r_node in G_rhs.nodes:
        if r_node in rhs_to_lhs:
            l_node = rhs_to_lhs[r_node]
            if l_node in lhs_to_input:
                i_node = lhs_to_input[l_node]
                if i_node in G_in:
                    ax, ay = get_pos(G_rhs, r_node)
                    anchors.append({
                        'rhs_id': r_node,
                        'input_id': i_node,
                        'x': ax,
                        'y': ay
                    })

    for rhs_node in list(G_rhs.nodes):
        if rhs_node not in visited_rhs:
            # Found an orphan
            rx, ry = get_pos(G_rhs, rhs_node)
            
            # Find closest anchor
            best_anchor = None
            min_dist_sq = float('inf')
            
            if anchors:
                for anc in anchors:
                    dist_sq = (rx - anc['x'])**2 + (ry - anc['y'])**2
                    if dist_sq < min_dist_sq:
                        min_dist_sq = dist_sq
                        best_anchor = anc
            
            # Generate new ID
            new_id = next_new_id
            next_new_id += 1
            visited_rhs.add(rhs_node)
            rhs_new_to_input[rhs_node] = new_id
            created_nodes_count += 1
            
            if best_anchor:
                # Calculate relative position
                dx = rx - best_anchor['x']
                dy = ry - best_anchor['y']
                
                # Apply to Input Anchor
                anc_ix, anc_iy = get_pos(G_in, best_anchor['input_id'])
                final_x = anc_ix + dx
                final_y = anc_iy + dy
                
                G_in.add_node(new_id, x=final_x, y=final_y)
                logger.info(f"Added orphan node {new_id} (from RHS {rhs_node}) relative to anchor {best_anchor['input_id']}")
            else:
                # No anchors available (total rewrite or empty input), use absolute
                G_in.add_node(new_id, x=rx, y=ry)
                logger.info(f"Added orphan node {new_id} (from RHS {rhs_node}) absolute position")


    # --- Convert back to node-link -------------------------------------------

    data = json_graph.node_link_data(G_in)
    nodes = [Node(id=n["id"], x=n.get("x"), y=n.get("y")) for n in data["nodes"]]
    links = [Link(source=l["source"], target=l["target"]) for l in data["links"]]

    logger.info(
        "Result: nodes=%d edges=%d | created_nodes=%d removed_nodes=%d added_edges=%d",
        len(nodes), len(links), created_nodes_count, removed_nodes_count, added_edges_count,
    )

    return CalculateResponseGraph(
        directed=data.get("directed", False),
        multigraph=data.get("multigraph", False),
        graph=data.get("graph", {}),
        nodes=nodes,
        links=links,
    )

from typing import Dict, List, Optional, Union
import json
import logging
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
        logger.info(
            "Mappings: lhs->input=%d rhs->lhs=%d",
            len(req.mapping_lhs_to_input), len(req.mapping_rhs_to_lhs),
        )
        logger.debug("lhs->input: %s", json.dumps(req.mapping_lhs_to_input, indent=2))
        logger.debug("rhs->lhs: %s", json.dumps(req.mapping_rhs_to_lhs, indent=2))
    except Exception as e:
        logger.warning("Failed to log request summary: %s", e)

    G_in  = req.graph_input.to_networkx()
    G_lhs = req.graph_lhs.to_networkx()
    G_rhs = req.graph_rhs.to_networkx()


    # normalize mappings coming from JSON (keys are usually strings)
    lhs_to_input = { _norm_nodeid(k): _norm_nodeid(v) for k, v in req.mapping_lhs_to_input.items() }
    rhs_to_lhs   = { _norm_nodeid(k): _norm_nodeid(v) for k, v in req.mapping_rhs_to_lhs.items() }
    logger.info("Normalized mappings sizes: lhs->input=%d rhs->lhs=%d", len(lhs_to_input), len(rhs_to_lhs))

    # lhs_to_input = dict(req.mapping_lhs_to_input)
    # rhs_to_lhs   = dict(req.mapping_rhs_to_lhs)

    # Reverse map: LHS → list of RHS nodes that map to it
    lhs_from_rhs = {}
    for rhs_id, lhs_id in rhs_to_lhs.items():
        lhs_from_rhs.setdefault(lhs_id, []).append(rhs_id)

    # Create IDs for new nodes (for RHS neighbors that don't map to LHS)
    try:
        max_input_id = max(int(n) for n in G_in.nodes)
    except Exception:
        max_input_id = 0
    next_new_id = max_input_id + 1

    rhs_new_to_input = {}   # RHS-id → created input-id
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

    def create_rhs_only_node(rhs_id, rhs_src, input_src):
        """Create a new Input graph node corresponding to an RHS neighbor
           that does not map to LHS."""
        nonlocal next_new_id
        nonlocal created_nodes_count
        if rhs_id in rhs_new_to_input:
            return rhs_new_to_input[rhs_id]
        in_pos      = G_in.nodes.get(input_src, {})
        new_x = float(in_pos.get("x", 0.0)) 
        new_y = float(in_pos.get("y", 0.0)) 
        new_id = next_new_id
        next_new_id += 1
        created_nodes_count += 1
        if not rhs_src and not input_src:
            G_in.add_node(new_id, x=new_x, y=new_y)
            return new_id
        rhs_pos     = G_rhs.nodes.get(rhs_src, {})
        rhs_nbr_pos = G_rhs.nodes.get(rhs_id,  {})
        

        dx = float(rhs_nbr_pos.get("x", 0.0)) - float(rhs_pos.get("x", 0.0))
        dy = float(rhs_nbr_pos.get("y", 0.0)) - float(rhs_pos.get("y", 0.0))

        new_x += new_x + dx
        new_y += new_y + dy

        

        G_in.add_node(new_id, x=new_x, y=new_y)
        rhs_new_to_input[rhs_id] = new_id
        logger.info(
            "Created input node %s from RHS %s (src rhs=%s,input=%s) at (%.3f, %.3f)",
            new_id, rhs_id, rhs_src, input_src, new_x, new_y,
        )
       
        

        return new_id

    # --- Main logic ----------------------------------------------------------

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

            # BFS queue holds (rhs_current, input_current_anchor)
            queue = deque()
            queue.append((rhs_start, input_id))
            visited_rhs: set = set()

            while queue:
                rhs_cur, input_cur = queue.popleft()
                if rhs_cur in visited_rhs:
                    continue
                visited_rhs.add(rhs_cur)

                # neighbors in RHS for expansion
                if G_rhs.is_directed():
                    neighbors_iter = G_rhs.successors(rhs_cur)
                else:
                    neighbors_iter = G_rhs.neighbors(rhs_cur)

                for rhs_nbr in neighbors_iter:
                    lhs_nbr = rhs_to_lhs.get(rhs_nbr)

                    if lhs_nbr is None:
                        # RHS-only neighbor ⇒ create new input node relative to current anchor
                        input_nbr = create_rhs_only_node(rhs_nbr, rhs_cur, input_cur)
                        if ensure_edge(input_cur, input_nbr):
                            added_edges_count += 1
                            logger.info("Added edge %s -> %s (RHS-only neighbor)", input_cur, input_nbr)
                        # expand frontier from this RHS neighbor with new input anchor
                        if rhs_nbr not in visited_rhs:
                            queue.append((rhs_nbr, input_nbr))
                        continue

                    # LHS → Input mapping exists
                    input_nbr = lhs_to_input.get(lhs_nbr)
                    if input_nbr is None:
                        continue

                    if ensure_edge(input_cur, input_nbr):
                        added_edges_count += 1
                        logger.info("Added edge %s -> %s (mapped neighbor)", input_cur, input_nbr)
                    # expand frontier from mapped neighbor
                    if rhs_nbr not in visited_rhs:
                        queue.append((rhs_nbr, input_nbr))
            for rhs_node in list(G_rhs.nodes):
                if rhs_node not in visited_rhs:
                    input_nbr = create_rhs_only_node( None, None,rhs_node)
                    logger.info("Added node only rhs")


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
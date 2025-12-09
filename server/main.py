from typing import Dict, List, Optional, Union
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import networkx as nx
from networkx.readwrite import json_graph

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

@app.post("/calculate", response_model=CalculateResponseGraph)
def calculate(req: CalculateRequest):

    G_in  = req.graph_input.to_networkx()
    G_lhs = req.graph_lhs.to_networkx()
    G_rhs = req.graph_rhs.to_networkx()

    lhs_to_input = dict(req.mapping_lhs_to_input)
    rhs_to_lhs   = dict(req.mapping_rhs_to_lhs)

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

    # --- Helper functions -----------------------------------------------------

    def ensure_edge(u, v):
        """Add edge if missing (handles directed/undirected)."""
        if G_in.is_directed():
            if not G_in.has_edge(u, v):
                G_in.add_edge(u, v)
        else:
            if not G_in.has_edge(u, v) and not G_in.has_edge(v, u):
                G_in.add_edge(u, v)

    def create_rhs_only_node(rhs_id, rhs_src, input_src):
        """Create a new Input graph node corresponding to an RHS neighbor
           that does not map to LHS."""
        nonlocal next_new_id

        if rhs_id in rhs_new_to_input:
            return rhs_new_to_input[rhs_id]

        rhs_pos     = G_rhs.nodes.get(rhs_src, {})
        rhs_nbr_pos = G_rhs.nodes.get(rhs_id,  {})
        in_pos      = G_in.nodes.get(input_src, {})

        dx = float(rhs_nbr_pos.get("x", 0.0)) - float(rhs_pos.get("x", 0.0))
        dy = float(rhs_nbr_pos.get("y", 0.0)) - float(rhs_pos.get("y", 0.0))

        new_x = float(in_pos.get("x", 0.0)) + dx
        new_y = float(in_pos.get("y", 0.0)) + dy

        new_id = next_new_id
        next_new_id += 1

        G_in.add_node(new_id, x=new_x, y=new_y)
        rhs_new_to_input[rhs_id] = new_id

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
            continue

        # Node is preserved → process outgoing edges from RHS
        for rhs_id in rhs_list:

            if rhs_id not in G_rhs:
                continue

            if G_rhs.is_directed():
                rhs_neighbors = G_rhs.successors(rhs_id)
            else:
                rhs_neighbors = G_rhs.neighbors(rhs_id)

            for rhs_nbr in rhs_neighbors:

                lhs_nbr = rhs_to_lhs.get(rhs_nbr)

                if lhs_nbr is None:
                    # RHS-only neighbor ⇒ create new input node
                    input_nbr = create_rhs_only_node(rhs_nbr, rhs_id, input_id)
                    ensure_edge(input_id, input_nbr)
                    continue

                # LHS → Input mapping exists
                input_nbr = lhs_to_input.get(lhs_nbr)
                if input_nbr is None:
                    continue

                ensure_edge(input_id, input_nbr)

    # --- Convert back to node-link -------------------------------------------

    data = json_graph.node_link_data(G_in)
    nodes = [Node(id=n["id"], x=n.get("x"), y=n.get("y")) for n in data["nodes"]]
    links = [Link(source=l["source"], target=l["target"]) for l in data["links"]]

    return CalculateResponseGraph(
        directed=data.get("directed", False),
        multigraph=data.get("multigraph", False),
        graph=data.get("graph", {}),
        nodes=nodes,
        links=links,
    )

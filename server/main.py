from typing import Dict, List, Optional, Union
from fastapi import FastAPI, HTTPException
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
        # Convert to the dict format expected by json_graph
        data = {
            "directed": self.directed,
            "multigraph": self.multigraph,
            "graph": self.graph,
            "nodes": [n.model_dump() for n in self.nodes],
            "links": [e.model_dump() for e in self.links],
        }
        return json_graph.node_link_graph(data, directed=self.directed, multigraph=self.multigraph)


class CalculateRequest(BaseModel):
    # Mappings
    mapping_lhs_to_input: Dict[NodeId, NodeId] = Field(default_factory=dict)
    mapping_rhs_to_lhs: Dict[NodeId, NodeId] = Field(default_factory=dict)

    # Graphs (node-link format)
    graph_input: NodeLinkGraph
    graph_lhs: NodeLinkGraph
    graph_rhs: NodeLinkGraph


class MappingValidation(BaseModel):
    size: int
    keys_exist: bool
    values_exist: bool


class CalculateResponseGraph(NodeLinkGraph):
    pass


app = FastAPI(title="Graph Calculate API")

# Allow Vite dev server and any local origins by default
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/calculate", response_model=CalculateResponseGraph)
def calculate(req: CalculateRequest):
    # For now, just echo the input graph back as the calculated result
    # This keeps the front-end integration simple initially.
    try:
        # validate parsability (will raise if invalid)
        _ = req.graph_input.to_networkx()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse input graph: {e}")

    return CalculateResponseGraph(
        directed=req.graph_input.directed,
        multigraph=req.graph_input.multigraph,
        graph=req.graph_input.graph,
        nodes=req.graph_input.nodes,
        links=req.graph_input.links,
    )


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}

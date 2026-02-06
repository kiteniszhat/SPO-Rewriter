from typing import Dict, List, Union
from pydantic import BaseModel, Field
import networkx as nx
NodeId = Union[int, str]

class Node(BaseModel):
    id: NodeId
    x: float|None = None
    y: float|None = None

class Link(BaseModel):
    source: NodeId
    target: NodeId

class NodeLinkGraph(BaseModel):
    graph: Dict = Field(default_factory=dict) 
    nodes: List[Node] = Field(default_factory=list)
    links: List[Link] = Field(default_factory=list)
    def to_networkx(self) -> nx.Graph:
        data = {
            "graph": self.graph,
            "nodes": [n.model_dump() for n in self.nodes],
            "links": [e.model_dump() for e in self.links],
        }
        return nx.json_graph.node_link_graph(data)

class CalculateRequest(BaseModel):
    mapping_lhs_to_input: Dict[NodeId, NodeId] = Field(default_factory=dict)
    mapping_rhs_to_lhs: Dict[NodeId, NodeId] = Field(default_factory=dict)
    graph_input: NodeLinkGraph
    graph_lhs: NodeLinkGraph
    graph_rhs: NodeLinkGraph
    
import logging
from typing import Dict, List, Optional, Union
from models import NodeId,CalculateRequest,NodeLinkGraph,Link,Node
import json
from fastapi import HTTPException
from collections import deque
from networkx.readwrite import json_graph
import networkx as nx
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

def _norm_ids(mapping: Dict[NodeId,NodeId])->Dict:
    # normalize ids to int if possible
    def _to_int_helper(n:NodeId)->NodeId:
        if isinstance(n, int):
            return n
        if isinstance(n, str):
            logger.info("was a string")
            try:
                return int(n)
            except ValueError:
                return n
        return n
    return {_to_int_helper(n1): _to_int_helper(n2) for n1,n2 in mapping.items()}
def _check_morphism(G_in:nx.Graph,G_lhs:nx.Graph,lhs_to_input:nx.Graph) ->None:
    for lhs_id in list(G_lhs.nodes):

        input_id = lhs_to_input.get(lhs_id)
        if input_id is None:
            raise HTTPException(status_code=400, detail="error: lhs isn't fully mapped to input")
        lhs_nbrs = G_lhs.neighbors(lhs_id)
        lhs_nbrs_list = list(G_lhs.neighbors(lhs_id))
        inp_nbrs_set = set(G_in.neighbors(input_id)) 
        inp_lhs_nbrs_mapped = {lhs_to_input.get(l) for l in lhs_nbrs_list if lhs_to_input.get(l) is not None}
        print(f"LHS {lhs_id} mapped to input {input_id}")
        print(f"Mapped LHS neighbors -> input ids: {sorted(inp_lhs_nbrs_mapped)}")
        print(f"Input neighbors of {input_id}: {sorted(inp_nbrs_set)}")
        #neighbors matching
        if not inp_lhs_nbrs_mapped.issubset(inp_nbrs_set):
            raise HTTPException(status_code=400, detail="error: no morphism")
        # more edges than in input graph
        #to 
        for l in lhs_nbrs:
            print(l)
            i = lhs_to_input.get(l)
            print(f"mapped to {i}, {input_id}")
            if G_in.has_edge(i,input_id) or  G_in.has_edge(input_id,i):
                print("true")
                continue
            else:
                raise HTTPException(status_code=400, detail="error: no morphism")
        #to chyba nie jest potrzebne ale coz szkodzi obiecac, załatwia to już neighbors matching
        #less edges than in input graph
        for l in list(G_lhs.nodes):
            if l == lhs_id:
                pass
            i = lhs_to_input.get(l)
            if G_in.has_edge(input_id,i):
                if not G_lhs.has_edge(lhs_id,l):
                    raise HTTPException(status_code=400, detail="error: no morphism")
    return True
def calculate(req: CalculateRequest) -> NodeLinkGraph:
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


    lhs_to_input = _norm_ids(req.mapping_lhs_to_input)
    rhs_to_lhs   = _norm_ids(req.mapping_rhs_to_lhs)
    logger.info("Normalized mappings sizes: lhs->input=%d rhs->lhs=%d", len(lhs_to_input), len(rhs_to_lhs))


    # Reverse map: LHS → list of RHS nodes that map to it
    lhs_to_rhs = {}
    for rhs_id, lhs_id in rhs_to_lhs.items():
        lhs_to_rhs.setdefault(lhs_id, []).append(rhs_id)

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
    removed_edges_count_edges = 0

    # --- Helper functions -----------------------------------------------------

    def ensure_edge(u, v):
        """Add edge if missing (undirected)."""
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
    _check_morphism(G_in,G_lhs,lhs_to_input)

    for lhs_id in list(G_lhs.nodes):
        input_id = lhs_to_input.get(lhs_id)
       
        if input_id is None:
            continue  # unmapped LHS is ignored

        rhs_list = lhs_to_rhs.get(lhs_id, [])
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
              
                neighbors_iter = G_rhs.neighbors(rhs_cur)
                # Compare neighbor counts using degree
                try:
                    
                    rhs_deg = G_rhs.degree(rhs_cur)
                    in_deg = G_in.degree(input_cur)
                    # Optional: keep for diagnostics if needed
                    # logger.debug("Degree compare rhs=%s(%d) input=%s(%d)", rhs_cur, rhs_deg, input_cur, in_deg)
                except Exception:
                    rhs_deg = None
                    in_deg = None
                
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
                if rhs_node not in visited_rhs and not rhs_node in lhs_to_rhs:
                    input_nbr = create_rhs_only_node( None, None,rhs_node)
                    logger.info("Added node only rhs")

    # --- Remove edges that were in LHS but disappeared in RHS ---
    # For each LHS edge (lu, lv), if mapped input endpoints exist but no
    # corresponding RHS edge between any rhs mapped to lu and lv, remove the input edge.
    for lu, lv in G_lhs.edges():
        in_u = lhs_to_input.get(lu)
        in_v = lhs_to_input.get(lv)
        if in_u is None or in_v is None:
            continue

        rhs_us = lhs_to_rhs.get(lu, [])
        rhs_vs = lhs_to_rhs.get(lv, [])
        # Determine if any RHS pair has an edge
        rhs_has_edge = False
        
        for ru in rhs_us:
            for rv in rhs_vs:
                if G_rhs.has_edge(ru, rv):
                    rhs_has_edge = True
                    break
            if rhs_has_edge:
                break
      

        # If RHS lacks the edge, remove corresponding input edge if present
        if not rhs_has_edge:
            try:
                if G_in.has_edge(in_u, in_v):
                    G_in.remove_edge(in_u, in_v)
                    removed_edges_count_edges += 1
                    logger.info("Removed input edge %s -- %s (LHS edge disappeared in RHS)", in_u, in_v)
                elif G_in.has_edge(in_v, in_u):
                    G_in.remove_edge(in_v, in_u)
                    removed_edges_count_edges += 1
                    logger.info("Removed input edge %s -- %s (LHS edge disappeared in RHS)", in_v, in_u)
            except Exception as exc:
                logger.warning("Failed removing mapped input edge %s-%s: %s", in_u, in_v, exc)


    # --- Convert back to node-link -------------------------------------------

    data = json_graph.node_link_data(G_in)
    nodes = [Node(id=n["id"], x=n.get("x"), y=n.get("y")) for n in data["nodes"]]
    links = [Link(source=l["source"], target=l["target"]) for l in data["links"]]

    logger.info(
        "Result: nodes=%d edges=%d | created_nodes=%d removed_nodes=%d added_edges=%d removed_edges=%d",
        len(nodes), len(links), created_nodes_count, removed_nodes_count, added_edges_count, removed_edges_count_edges,
    )

    return NodeLinkGraph(
      
        graph=data.get("graph", {}),
        nodes=nodes,
        links=links,
    )
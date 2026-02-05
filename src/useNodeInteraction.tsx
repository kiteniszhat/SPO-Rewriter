
function useNodeInteraction({setEdges,mappingActive,pendingFrom,setPendingFrom})
{
    const connectNodes = (a: NodeId, b: NodeId) => {
    if (a === b) return
    setEdges((prev) => {
        const idx = prev.findIndex(
        (ed) => (ed.source === a && ed.target === b) || (ed.source === b && ed.target === a)
        )
        
        if (idx !== -1) {
        const next = [...prev]
        next.splice(idx, 1)
        return next
        }
        return [...prev, { source: a, target: b }]
    })}

    const onNodeContextMenu = 
    (nodeId: NodeId, e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (mappingActive) return
        
        if(pendingFrom===null) setPendingFrom(nodeId)
        else if(pendingFrom===nodeId) setPendingFrom(null)
        else 
        { 
        connectNodes(pendingFrom,nodeId)
        setPendingFrom(null)
        }
    }
      return {onNodeContextMenu}
    
}
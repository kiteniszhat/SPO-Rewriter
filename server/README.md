# Graph Calculate API (FastAPI)

This is a minimal Python backend for your Vite/React graph editor.
It exposes a POST `/calculate` endpoint that accepts:

- `graph_input`: Input graph (node-link JSON)
- `graph_lhs`: LHS graph (node-link JSON)
- `graph_rhs`: RHS graph (node-link JSON)
- `mapping_lhs_to_input`: mapping LHS node id → Input node id
- `mapping_rhs_to_lhs`: mapping RHS node id → LHS node id

The server parses the graphs into NetworkX graphs, does basic mapping validation (keys/values existence), and returns counts and validation flags.

## Run locally

```powershell
cd server
python -m venv .venv
. .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open Swagger docs at http://localhost:8000/docs

## Example request (PowerShell)

```powershell
$body = @{
  mapping_lhs_to_input = @{ "1" = 4; "2" = 2 }
  mapping_rhs_to_lhs = @{ "10" = 1; "20" = 2 }
  graph_input = @{
    directed = $false
    multigraph = $false
    graph = @{}
    nodes = @(@{ id = 1; x = 100; y = 120 }, @{ id = 2; x = 220; y = 160 }, @{ id = 4; x = 80; y = 60 })
    links = @(@{ source = 1; target = 2 }, @{ source = 4; target = 2 })
  }
  graph_lhs = @{
    directed = $false
    multigraph = $false
    graph = @{}
    nodes = @(@{ id = 1; x = 10; y = 12 }, @{ id = 2; x = 22; y = 16 })
    links = @(@{ source = 1; target = 2 })
  }
  graph_rhs = @{
    directed = $false
    multigraph = $false
    graph = @{}
    nodes = @(@{ id = 10; x = 5; y = 8 }, @{ id = 20; x = 12; y = 14 })
    links = @(@{ source = 10; target = 20 })
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri http://localhost:8000/calculate -Headers @{ 'Content-Type' = 'application/json' } -Body $body
```

Note: JSON keys are strings by default in PowerShell. The server accepts both integer and string node ids.

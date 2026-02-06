

from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from models import CalculateRequest,NodeLinkGraph
from logic import calculate
app = FastAPI(title="Graph Calculate API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.post("/calculate")
def calculate_endpoint(req: CalculateRequest) -> NodeLinkGraph:
    return calculate(req)
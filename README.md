```powershell
npm install
npm run dev
```
Frontend: `http://localhost:5173/`

## Backend (FastAPI)

```powershell
cd server
python -m venv .venv
. .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
- API docs: `http://localhost:8000/docs`
- Endpoint: `POST /calculate`

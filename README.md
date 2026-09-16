# PR Reviewer Portal

React frontend and FastAPI backend for registering GitHub repositories.

## Frontend

```powershell
npm install
npm run dev
```

## Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend creates `backend/pr_reviewer.db` and the `repositories` table on startup. It verifies the supplied GitHub username and App password before saving the repository, then stores the App password as a salted `scrypt` hash. Set `SQLITE_DATABASE` to use a different SQLite file. Review rules are not stored during registration.

Open `http://localhost:5173`. Registration verifies the repository with GitHub before saving it.

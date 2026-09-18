# PR Reviewer Portal

React frontend and FastAPI backend for registering GitHub repositories.

## Frontend

```powershell
cd frontend
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

Set `N8N_PR_REVIEW_WEBHOOK_URL` in `backend/.env` to the production webhook URL from the active n8n workflow, for example `https://your-n8n-host/webhook/pr-review`.

The backend creates `backend/pr_reviewer.db` and the `repositories` table on startup. It verifies the supplied GitHub username and App password, creates or updates the repository webhook for `pull_request` events, then creates or updates these files in the repository:

- `PR Reviewer/config.json` contains four agent toggles, all enabled by default: `architecture`, `code_quality`, `regression`, and `alignment`.
- `PR Reviewer/index.json` contains the dynamic Git tree, including directories, files, branch, and truncation status.

After the GitHub files are updated, the backend stores the App password as a salted `scrypt` hash. Set `SQLITE_DATABASE` to use a different SQLite file.

Open `http://localhost:5173`. Registration verifies the repository with GitHub before saving it.

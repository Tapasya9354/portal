from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
from base64 import b64encode
from urllib.parse import urlparse
from urllib.parse import quote

import httpx
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

load_dotenv()

app = FastAPI(
    title="PR Reviewer Portal API",
    description="Verify and register GitHub repositories and provide KT Chatbot assistance for the PR Reviewer backend.",
    version="0.2.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    openapi_tags=[
        {"name": "System", "description": "Service health and readiness endpoints."},
        {"name": "Repositories", "description": "GitHub repository registration and retrieval."},
        {"name": "KT Chatbot", "description": "Knowledge Transfer Chatbot interactions and callbacks."},
    ],
)

cors_origins_str = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:1805,http://localhost:1806,http://192.168.1.104:1805,http://192.168.1.104:1806,https://prreviewer.nik-server.in"
)
cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Symmetric encryption for secure PAT storage and retrieval
FERNET_KEY = os.getenv("ENCRYPTION_SECRET_KEY")
if not FERNET_KEY:
    # Stable fallback key for development if not set in environment
    FERNET_KEY = "Qh768RvCVZfJpWcyzEBElBqAJhTiEDQeRwgiGP8uSeE="

fernet = Fernet(FERNET_KEY.encode() if isinstance(FERNET_KEY, str) else FERNET_KEY)


def encrypt_token(token: str) -> str:
    return fernet.encrypt(token.encode("utf-8")).decode("utf-8")


def decrypt_token(encrypted_token: str) -> str:
    return fernet.decrypt(encrypted_token.encode("utf-8")).decode("utf-8")


class RepositoryRegistration(BaseModel):
    """Credentials used to register a GitHub repository."""

    repository_url: str = Field(min_length=1)
    github_username: str = Field(min_length=1, max_length=100)
    github_app_password: str = Field(min_length=1, description="GitHub App password / Personal Access Token.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "repository_url": "https://github.com/example/repository",
                "github_username": "github-user",
                "github_app_password": "your-app-password",
            }
        }
    }

    @field_validator("repository_url")
    @classmethod
    def validate_repository_url(cls, value: str) -> str:
        parsed = urlparse(value.strip().rstrip("/"))
        parts = [part for part in parsed.path.split("/") if part]
        if parsed.scheme != "https" or parsed.netloc != "github.com" or len(parts) != 2:
            raise ValueError("Use a public GitHub repository URL like https://github.com/org/repository")
        return f"https://github.com/{parts[0]}/{parts[1]}"


class RepositoryResponse(BaseModel):
    """Safe registration result with no credential material."""

    repository_url: str
    full_name: str
    registered_at: datetime
    github_status: int
    message: str


class RepositoryListItem(BaseModel):
    """Registered repository public summary."""

    id: int
    repository_url: str
    full_name: str
    github_username: str
    status: str
    webhook_registered: bool
    created_at: str


class ChatRequest(BaseModel):
    """User question for the KT Chatbot."""

    repository_id: int = Field(description="The registered repository ID.")
    session_id: str = Field(min_length=1, description="Unique conversation session ID.")
    query: str = Field(min_length=1, description="The question or prompt for the KT bot.")

    model_config = {
        "json_schema_extra": {
            "example": {
                "repository_id": 1,
                "session_id": "session-12345",
                "query": "Where is the authentication flow handled and what rules apply?",
            }
        }
    }


class ChatResponseStatus(BaseModel):
    """Immediate status acknowledging query dispatch."""

    session_id: str
    status: str
    message: str


class ChatCallback(BaseModel):
    """Callback payload sent by the n8n KT Chatbot workflow."""

    sessionId: str
    response: str
    status: str = "completed"


class ChatMessageItem(BaseModel):
    """Chat message history item."""

    id: int
    repository_id: int
    session_id: str
    role: str
    content: str
    status: str
    created_at: str


class ChatSessionItem(BaseModel):
    """Summary of a chat session thread."""

    session_id: str
    first_query: str
    created_at: str


DATABASE_PATH = Path(os.getenv("SQLITE_DATABASE", Path(__file__).resolve().parents[1] / "pr_reviewer.db"))

ARCHITECTURE_RULES_PATH = "PR Reviewer/architecture-rules.md"
TECH_STACK_PATH = "PR Reviewer/tech-stack.md"
ARCHITECTURE_RULES_TEMPLATE = """# Architecture Rules

Describe the architectural rules the PR Reviewer's Architecture Agent should enforce, \
for example layering boundaries, module ownership, disallowed dependencies, or naming conventions.

- (Add your rules here)
"""
TECH_STACK_TEMPLATE = """# Tech Stack

Describe the project's tech stack so the PR Reviewer agents have accurate context, \
for example languages, frameworks, libraries, and infrastructure.

- (Add your stack details here)
"""


def initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS repositories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repository_url TEXT NOT NULL UNIQUE,
                full_name TEXT NOT NULL,
                github_username TEXT NOT NULL,
                app_password_hash TEXT NOT NULL,
                app_password_encrypted TEXT,
                status TEXT NOT NULL DEFAULT 'completed',
                webhook_registered INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        columns = {row[1] for row in connection.execute("PRAGMA table_info(repositories)")}
        if "rules_json" in columns:
            connection.execute("ALTER TABLE repositories DROP COLUMN rules_json")
        if "password_hash" in columns and "app_password_hash" not in columns:
            connection.execute("ALTER TABLE repositories RENAME COLUMN password_hash TO app_password_hash")
        if "app_password_encrypted" not in columns:
            connection.execute("ALTER TABLE repositories ADD COLUMN app_password_encrypted TEXT")
        if "status" not in columns:
            connection.execute("ALTER TABLE repositories ADD COLUMN status TEXT DEFAULT 'completed'")
        if "webhook_registered" not in columns:
            connection.execute("ALTER TABLE repositories ADD COLUMN webhook_registered INTEGER DEFAULT 1")

        connection.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repository_id INTEGER NOT NULL REFERENCES repositories(id),
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'completed',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)


def hash_app_password(app_password: str) -> str:
    salt = secrets.token_bytes(16)
    password_hash = hashlib.scrypt(app_password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt$16384$8$1${salt.hex()}${password_hash.hex()}"


async def verify_github_repository(repository_url: str, username: str, app_password: str) -> tuple[int, str]:
    parsed = urlparse(repository_url)
    owner, name = [part for part in parsed.path.split("/") if part]
    api_url = f"https://api.github.com/repos/{owner}/{name}"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(api_url, headers=headers, auth=(username, app_password))
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="GitHub could not be reached. Try again shortly.") from exc
    if response.status_code != 200:
        detail = "GitHub rejected the repository or token. Check both values and try again."
        if response.status_code == 404:
            detail = "Repository not found or token does not have access to it."
        raise HTTPException(status_code=401 if response.status_code in (401, 403) else 400, detail=detail)
    return response.status_code, response.json().get("full_name", f"{owner}/{name}")


async def create_review_config(repository_url: str, username: str, app_password: str) -> None:
    parsed = urlparse(repository_url)
    owner, name = [part for part in parsed.path.split("/") if part]
    api_root = f"https://api.github.com/repos/{owner}/{name}"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    auth = (username, app_password)
    config = {
        "agents": {
            "architecture": True,
            "code_quality": True,
            "regression": True,
            "alignment": True,
        },
        "rules": {
            "architectural_rules_path": ARCHITECTURE_RULES_PATH,
            "tech_stack_path": TECH_STACK_PATH,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            repository = await client.get(api_root, headers=headers, auth=auth)
            repository.raise_for_status()
            default_branch = repository.json().get("default_branch", "main")
            tree_response = await client.get(
                f"{api_root}/git/trees/{quote(default_branch, safe='')}?recursive=1",
                headers=headers,
                auth=auth,
            )
            tree_response.raise_for_status()
            tree_payload = tree_response.json()
            tree_entries = list(tree_payload.get("tree", []))
            existing_paths = {entry.get("path") for entry in tree_entries}
            for generated_path in (
                "PR Reviewer/config.json",
                "PR Reviewer/index.json",
                ARCHITECTURE_RULES_PATH,
                TECH_STACK_PATH,
            ):
                if generated_path not in existing_paths:
                    tree_entries.append({"path": generated_path, "mode": "100644", "type": "blob"})
            index = {
                "version": "1.0",
                "branch": default_branch,
                "truncated": tree_payload.get("truncated", False),
                "tree": [
                    {
                        key: entry[key]
                        for key in ("path", "mode", "type", "sha", "size")
                        if key in entry
                    }
                    for entry in sorted(tree_entries, key=lambda value: value.get("path", ""))
                ],
            }

            managed_files = (
                ("PR Reviewer/config.json", json.dumps(config, indent=2), "Initialize PR Reviewer agent configuration", True),
                ("PR Reviewer/index.json", json.dumps(index, indent=2), "Update PR Reviewer repository index", True),
                (ARCHITECTURE_RULES_PATH, ARCHITECTURE_RULES_TEMPLATE, "Seed PR Reviewer architecture rules", False),
                (TECH_STACK_PATH, TECH_STACK_TEMPLATE, "Seed PR Reviewer tech stack notes", False),
            )

            for file_path, content, commit_message, always_overwrite in managed_files:
                existing = await client.get(
                    f"{api_root}/contents/{quote(file_path, safe='/')}?ref={quote(default_branch, safe='')}",
                    headers=headers,
                    auth=auth,
                )
                if existing.status_code not in (200, 404):
                    existing.raise_for_status()
                if existing.status_code == 200 and not always_overwrite:
                    continue

                payload = {
                    "message": commit_message,
                    "content": b64encode(content.encode()).decode(),
                    "branch": default_branch,
                }
                if existing.status_code == 200:
                    payload["sha"] = existing.json()["sha"]

                response = await client.put(
                    f"{api_root}/contents/{quote(file_path, safe='/')}",
                    headers=headers,
                    auth=auth,
                    json=payload,
                )
                response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="GitHub verification succeeded, but config.json could not be created.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="GitHub could not be reached while creating config.json.") from exc


async def register_pr_webhook(repository_url: str, username: str, app_password: str) -> None:
    webhook_url = os.getenv("N8N_PR_REVIEW_WEBHOOK_URL")
    if not webhook_url:
        raise HTTPException(status_code=503, detail="N8N_PR_REVIEW_WEBHOOK_URL is not configured.")

    parsed = urlparse(repository_url)
    owner, name = [part for part in parsed.path.split("/") if part]
    api_root = f"https://api.github.com/repos/{owner}/{name}"
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    auth = (username, app_password)
    hook_payload = {
        "name": "web",
        "active": True,
        "events": ["pull_request"],
        "config": {"url": webhook_url, "content_type": "json", "insecure_ssl": "0"},
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            hooks_response = await client.get(f"{api_root}/hooks", headers=headers, auth=auth)
            hooks_response.raise_for_status()
            matching_hook = next(
                (
                    hook
                    for hook in hooks_response.json()
                    if hook.get("config", {}).get("url") == webhook_url
                ),
                None,
            )
            if matching_hook:
                response = await client.patch(
                    f"{api_root}/hooks/{matching_hook['id']}",
                    headers=headers,
                    auth=auth,
                    json=hook_payload,
                )
            else:
                response = await client.post(
                    f"{api_root}/hooks",
                    headers=headers,
                    auth=auth,
                    json=hook_payload,
                )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="GitHub verification succeeded, but the PR Reviewer webhook could not be configured.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="GitHub could not be reached while configuring the PR Reviewer webhook.") from exc


async def store_registration(
    registration: RepositoryRegistration,
    full_name: str,
    status: str = "completed",
    webhook_registered: int = 1,
) -> None:
    try:
        with sqlite3.connect(DATABASE_PATH) as connection:
            connection.execute(
                """
                INSERT INTO repositories (
                    repository_url, full_name, github_username, 
                    app_password_hash, app_password_encrypted,
                    status, webhook_registered
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(repository_url) DO UPDATE SET
                    full_name = excluded.full_name,
                    github_username = excluded.github_username,
                    app_password_hash = excluded.app_password_hash,
                    app_password_encrypted = excluded.app_password_encrypted,
                    status = excluded.status,
                    webhook_registered = excluded.webhook_registered
                """,
                (
                    registration.repository_url,
                    full_name,
                    registration.github_username,
                    hash_app_password(registration.github_app_password),
                    encrypt_token(registration.github_app_password),
                    status,
                    webhook_registered,
                ),
            )
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail="The repository was verified, but database storage failed.") from exc


@app.get("/health", tags=["System"], summary="Check API health", response_description="The API is available.")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
async def startup() -> None:
    initialize_database()


@app.post(
    "/api/repositories",
    response_model=RepositoryResponse,
    status_code=201,
    tags=["Repositories"],
    summary="Verify and register a GitHub repository",
    response_description="The repository was verified with GitHub and saved.",
    responses={
        400: {"description": "Invalid repository URL or GitHub rejected the request."},
        401: {"description": "GitHub token is invalid or lacks access."},
        409: {"description": "Repository is already registered and all setup steps are completed."},
        502: {"description": "GitHub could not be reached."},
        503: {"description": "Repository verification succeeded, but database storage failed."},
    },
)
async def register_repository(registration: RepositoryRegistration) -> RepositoryResponse:
    # Check if this repository has already completed all registration and webhook steps in green
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        existing = connection.execute(
            "SELECT id, full_name, status, webhook_registered FROM repositories WHERE repository_url = ?",
            (registration.repository_url,),
        ).fetchone()
        if existing and existing["status"] == "completed" and existing["webhook_registered"] == 1:
            raise HTTPException(
                status_code=409,
                detail=f"Repository '{existing['full_name']}' is already registered. All setup steps from configuration to webhook registration have already been completed successfully.",
            )

    github_status, full_name = await verify_github_repository(
        registration.repository_url,
        registration.github_username,
        registration.github_app_password,
    )
    await create_review_config(
        registration.repository_url,
        registration.github_username,
        registration.github_app_password,
    )
    await register_pr_webhook(
        registration.repository_url,
        registration.github_username,
        registration.github_app_password,
    )
    await store_registration(registration, full_name, status="completed", webhook_registered=1)
    return RepositoryResponse(
        repository_url=registration.repository_url,
        full_name=full_name,
        registered_at=datetime.now(timezone.utc),
        github_status=github_status,
        message="Repository verified and registered.",
    )


@app.get(
    "/api/repositories",
    response_model=list[RepositoryListItem],
    tags=["Repositories"],
    summary="List all registered repositories",
    response_description="Returns a list of registered repositories.",
)
async def list_repositories() -> list[RepositoryListItem]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, repository_url, full_name, github_username, status, webhook_registered, created_at FROM repositories ORDER BY id DESC"
        ).fetchall()
        return [
            RepositoryListItem(
                id=row["id"],
                repository_url=row["repository_url"],
                full_name=row["full_name"],
                github_username=row["github_username"],
                status=row["status"] or "completed",
                webhook_registered=bool(row["webhook_registered"]),
                created_at=row["created_at"],
            )
            for row in rows
        ]


@app.post(
    "/api/kt/chat",
    response_model=ChatResponseStatus,
    status_code=202,
    tags=["KT Chatbot"],
    summary="Ask a question to the KT Chatbot",
    response_description="Returns acknowledgement that the query is dispatched for asynchronous processing.",
    responses={
        400: {"description": "Repository credentials missing or need re-registration."},
        404: {"description": "Repository not found."},
        502: {"description": "Failed to communicate with n8n workflow."},
        503: {"description": "N8N_KT_CHAT_WEBHOOK_URL not configured."},
    },
)
async def send_kt_chat_query(payload: ChatRequest) -> ChatResponseStatus:
    n8n_webhook_url = os.getenv("N8N_KT_CHAT_WEBHOOK_URL")
    if not n8n_webhook_url:
        raise HTTPException(status_code=503, detail="N8N_KT_CHAT_WEBHOOK_URL is not configured.")

    backend_base = os.getenv("BACKEND_BASE_URL", "http://192.168.1.104:1806").rstrip("/")
    callback_url = f"{backend_base}/api/kt/chat/callback"

    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        repo = connection.execute(
            "SELECT id, repository_url, github_username, app_password_encrypted FROM repositories WHERE id = ?",
            (payload.repository_id,),
        ).fetchone()

        if not repo:
            raise HTTPException(status_code=404, detail="Repository not found.")

        if not repo["app_password_encrypted"]:
            raise HTTPException(
                status_code=400,
                detail="Repository token is not available in encrypted store. Please re-register the repository.",
            )

        try:
            pat = decrypt_token(repo["app_password_encrypted"])
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Failed to decrypt repository token.") from exc

        # Save user message
        connection.execute(
            "INSERT INTO chat_messages (repository_id, session_id, role, content, status) VALUES (?, ?, 'user', ?, 'completed')",
            (payload.repository_id, payload.session_id, payload.query),
        )
        # Create pending assistant placeholder
        connection.execute(
            "INSERT INTO chat_messages (repository_id, session_id, role, content, status) VALUES (?, ?, 'assistant', '', 'processing')",
            (payload.repository_id, payload.session_id),
        )

    n8n_payload = {
        "repoUrl": repo["repository_url"],
        "username": repo["github_username"],
        "pat": pat,
        "sessionId": payload.session_id,
        "query": payload.query,
        "callbackUrl": callback_url,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(n8n_webhook_url, json=n8n_payload)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        with sqlite3.connect(DATABASE_PATH) as connection:
            connection.execute(
                "UPDATE chat_messages SET content = 'Failed to trigger n8n chatbot workflow.', status = 'error' WHERE session_id = ? AND role = 'assistant' AND status = 'processing'",
                (payload.session_id,),
            )
        raise HTTPException(status_code=502, detail=f"Failed to communicate with n8n chatbot workflow: {exc}") from exc

    return ChatResponseStatus(
        session_id=payload.session_id,
        status="processing",
        message="Query submitted. The KT agent is generating the answer.",
    )


@app.post(
    "/api/kt/chat/callback",
    tags=["KT Chatbot"],
    summary="Receive answer callback from n8n KT Chatbot",
    response_description="Acknowledges receipt of answer.",
)
async def kt_chat_callback(callback: ChatCallback) -> dict[str, str]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            UPDATE chat_messages 
            SET content = ?, status = ?
            WHERE id = (
                SELECT id FROM chat_messages 
                WHERE session_id = ? AND role = 'assistant' AND status = 'processing' 
                ORDER BY id DESC LIMIT 1
            )
            """,
            (callback.response, callback.status, callback.sessionId),
        )
    return {"status": "ok"}


@app.get(
    "/api/kt/chat/messages",
    response_model=list[ChatMessageItem],
    tags=["KT Chatbot"],
    summary="Get chat history for a session",
    response_description="Returns the list of messages in this session.",
)
async def get_chat_messages(session_id: str) -> list[ChatMessageItem]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, repository_id, session_id, role, content, status, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        return [
            ChatMessageItem(
                id=row["id"],
                repository_id=row["repository_id"],
                session_id=row["session_id"],
                role=row["role"],
                content=row["content"],
                status=row["status"],
                created_at=row["created_at"],
            )
            for row in rows
        ]


@app.get(
    "/api/kt/chat/sessions",
    response_model=list[ChatSessionItem],
    tags=["KT Chatbot"],
    summary="List all chat sessions for a repository",
    response_description="Returns distinct chat session threads with initial prompts.",
)
async def list_chat_sessions(repository_id: int) -> list[ChatSessionItem]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT session_id, content AS first_query, MIN(created_at) AS created_at
            FROM chat_messages
            WHERE repository_id = ? AND role = 'user'
            GROUP BY session_id
            ORDER BY created_at DESC
            """,
            (repository_id,),
        ).fetchall()
        return [
            ChatSessionItem(
                session_id=row["session_id"],
                first_query=row["first_query"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

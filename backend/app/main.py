from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from base64 import b64encode
from urllib.parse import urlparse
from urllib.parse import quote

import httpx
import jwt
from jwt import PyJWKClient
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
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
        {"name": "Reviews", "description": "Open pull requests and AI agent review comments per repository."},
        {"name": "KT Chatbot", "description": "Knowledge Transfer Chatbot interactions and callbacks."},
    ],
)

cors_origins_str = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:1805,http://localhost:1806,http://192.168.1.104:1805,http://192.168.1.104:1806,https://prreviewer.nik-server.in,https://n8n.nik-server.in"
)
cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache of PyJWKClient instances per Clerk issuer, so we only fetch each app's JWKS once.
_jwks_clients: dict[str, PyJWKClient] = {}


async def get_current_user_id(authorization: str = Header(default="")) -> str:
    """Verify a Clerk session token (RS256, verified against the issuer's published JWKS) and return the user id."""
    token = authorization.replace("Bearer ", "").strip() if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing Authorization header. Sign in and try again.")

    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Malformed session token.") from exc

    issuer = unverified.get("iss")
    if not issuer or not issuer.startswith("https://"):
        raise HTTPException(status_code=401, detail="Session token is missing a valid issuer.")

    jwks_client = _jwks_clients.get(issuer)
    if jwks_client is None:
        jwks_client = PyJWKClient(f"{issuer}/.well-known/jwks.json")
        _jwks_clients[issuer] = jwks_client

    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        decoded = jwt.decode(token, signing_key.key, algorithms=["RS256"], issuer=issuer, options={"verify_aud": False})
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session token.") from exc

    user_id = decoded.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Session token is missing a subject.")
    return user_id
# Symmetric encryption for secure PAT storage and retrieval.
# Must be set explicitly (no hardcoded fallback) since it protects stored GitHub tokens.
FERNET_KEY = os.getenv("ENCRYPTION_SECRET_KEY")
if not FERNET_KEY:
    raise RuntimeError(
        "ENCRYPTION_SECRET_KEY is not set. Generate one with: "
        "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    )

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


class RepositoryCredentials(BaseModel):
    """Decrypted GitHub credentials for internal n8n workflow use only."""

    github_username: str
    github_pat: str


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


class ReviewComment(BaseModel):
    """A single AI agent comment posted on a pull request, parsed from its GitHub comment body."""

    id: str
    path: str
    line: int | None = None
    severity: str
    category: str
    body: str
    html_url: str = ""
    created_at: str = ""


class PullRequestReview(BaseModel):
    """An open pull request and the AI review comments posted on it."""

    number: int
    title: str
    html_url: str
    author: str
    branch: str
    base_branch: str
    created_at: str
    review_event: str = ""
    summary: str = ""
    comments: list[ReviewComment] = []


class RepositoryReviews(BaseModel):
    """All open pull requests and AI review comments for a registered repository."""

    repository_id: int
    full_name: str
    pull_requests: list[PullRequestReview] = []


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
        if "clerk_user_id" not in columns:
            connection.execute("ALTER TABLE repositories ADD COLUMN clerk_user_id TEXT")

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


# Matches comment bodies produced by the FormatComments workflow node, e.g.
# "[BLOCKER] [ARCHITECTURE]\n\ncomment text\n\n_Generated by CodeGuards AI Review_"
REVIEW_COMMENT_PATTERN = re.compile(
    r"^\[(BLOCKER|WARNING|SUGGESTION)\]\s*\[([A-Z0-9-]+)\]\s*\n+(.*?)(?:\n+_Generated by CodeGuards AI Review_\s*)?$",
    re.DOTALL | re.IGNORECASE,
)


def parse_review_comment_body(body: str) -> tuple[str, str, str] | None:
    match = REVIEW_COMMENT_PATTERN.match((body or "").strip())
    if not match:
        return None
    severity, category, text = match.group(1).lower(), match.group(2).lower(), match.group(3).strip()
    return severity, category, text


async def fetch_open_pull_requests(client: httpx.AsyncClient, owner: str, name: str, auth: tuple[str, str]) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    response = await client.get(
        f"https://api.github.com/repos/{owner}/{name}/pulls",
        headers=headers,
        auth=auth,
        params={"state": "open", "per_page": 50},
    )
    response.raise_for_status()
    return response.json()


async def fetch_pr_review_comments(client: httpx.AsyncClient, owner: str, name: str, number: int, auth: tuple[str, str]) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    response = await client.get(
        f"https://api.github.com/repos/{owner}/{name}/pulls/{number}/comments",
        headers=headers,
        auth=auth,
        params={"per_page": 100},
    )
    response.raise_for_status()
    return response.json()


async def fetch_pr_reviews(client: httpx.AsyncClient, owner: str, name: str, number: int, auth: tuple[str, str]) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    response = await client.get(
        f"https://api.github.com/repos/{owner}/{name}/pulls/{number}/reviews",
        headers=headers,
        auth=auth,
        params={"per_page": 50},
    )
    response.raise_for_status()
    return response.json()


async def build_repository_reviews(repo_row: sqlite3.Row) -> RepositoryReviews:
    """Fetch open PRs for a registered repository and parse the AI agents' review comments from GitHub."""
    full_name = repo_row["full_name"]
    owner, name = full_name.split("/", 1)
    username = repo_row["github_username"]

    if not repo_row["app_password_encrypted"]:
        raise HTTPException(status_code=400, detail=f"Token unavailable for '{full_name}'. Please re-register.")
    try:
        token = decrypt_token(repo_row["app_password_encrypted"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to decrypt token for '{full_name}'.") from exc

    auth = (username, token)
    pull_requests: list[PullRequestReview] = []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            prs = await fetch_open_pull_requests(client, owner, name, auth)
            for pr in prs:
                number = pr["number"]
                try:
                    raw_comments = await fetch_pr_review_comments(client, owner, name, number, auth)
                    raw_reviews = await fetch_pr_reviews(client, owner, name, number, auth)
                except httpx.HTTPError:
                    raw_comments, raw_reviews = [], []

                comments: list[ReviewComment] = []
                for raw in raw_comments:
                    if (raw.get("user") or {}).get("login", "").lower() != username.lower():
                        continue
                    parsed = parse_review_comment_body(raw.get("body"))
                    if not parsed:
                        continue
                    severity, category, text = parsed
                    comments.append(
                        ReviewComment(
                            id=str(raw.get("id", "")),
                            path=raw.get("path") or "",
                            line=raw.get("line") or raw.get("original_line"),
                            severity=severity,
                            category=category,
                            body=text,
                            html_url=raw.get("html_url", ""),
                            created_at=raw.get("created_at", ""),
                        )
                    )

                bot_reviews = [
                    r for r in raw_reviews
                    if (r.get("user") or {}).get("login", "").lower() == username.lower() and r.get("body")
                ]
                latest_review = bot_reviews[-1] if bot_reviews else None

                pull_requests.append(
                    PullRequestReview(
                        number=number,
                        title=pr.get("title", ""),
                        html_url=pr.get("html_url", ""),
                        author=(pr.get("user") or {}).get("login", ""),
                        branch=(pr.get("head") or {}).get("ref", ""),
                        base_branch=(pr.get("base") or {}).get("ref", ""),
                        created_at=pr.get("created_at", ""),
                        review_event=(latest_review or {}).get("state", ""),
                        summary=(latest_review or {}).get("body", ""),
                        comments=comments,
                    )
                )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"GitHub rejected the request for '{full_name}'.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"GitHub could not be reached for '{full_name}'.") from exc

    return RepositoryReviews(repository_id=repo_row["id"], full_name=full_name, pull_requests=pull_requests)


async def store_registration(
    registration: RepositoryRegistration,
    full_name: str,
    clerk_user_id: str,
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
                    status, webhook_registered, clerk_user_id
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(repository_url) DO UPDATE SET
                    full_name = excluded.full_name,
                    github_username = excluded.github_username,
                    app_password_hash = excluded.app_password_hash,
                    app_password_encrypted = excluded.app_password_encrypted,
                    status = excluded.status,
                    webhook_registered = excluded.webhook_registered,
                    clerk_user_id = excluded.clerk_user_id
                """,
                (
                    registration.repository_url,
                    full_name,
                    registration.github_username,
                    hash_app_password(registration.github_app_password),
                    encrypt_token(registration.github_app_password),
                    status,
                    webhook_registered,
                    clerk_user_id,
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
async def register_repository(
    registration: RepositoryRegistration,
    user_id: str = Depends(get_current_user_id),
) -> RepositoryResponse:
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
    await store_registration(registration, full_name, user_id, status="completed", webhook_registered=1)
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
async def list_repositories(user_id: str = Depends(get_current_user_id)) -> list[RepositoryListItem]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, repository_url, full_name, github_username, status, webhook_registered, created_at FROM repositories WHERE clerk_user_id = ? ORDER BY id DESC",
            (user_id,),
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


@app.get(
    "/api/repositories/{repository_id}/reviews",
    response_model=RepositoryReviews,
    tags=["Reviews"],
    summary="Get open PRs and AI review comments for a repository",
    response_description="Open pull requests with the AI agents' parsed review comments.",
    responses={
        400: {"description": "Repository token unavailable; re-registration required."},
        404: {"description": "Repository not found."},
        502: {"description": "GitHub could not be reached or rejected the request."},
    },
)
async def get_repository_reviews(repository_id: int, user_id: str = Depends(get_current_user_id)) -> RepositoryReviews:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        repo = connection.execute(
            "SELECT id, full_name, github_username, app_password_encrypted FROM repositories WHERE id = ? AND clerk_user_id = ?",
            (repository_id, user_id),
        ).fetchone()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found.")
    return await build_repository_reviews(repo)


@app.get(
    "/api/reviews",
    response_model=list[RepositoryReviews],
    tags=["Reviews"],
    summary="Get open PRs and AI review comments for all registered repositories",
    response_description="Open pull requests with the AI agents' parsed review comments, per repository.",
)
async def list_all_reviews(user_id: str = Depends(get_current_user_id)) -> list[RepositoryReviews]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, full_name, github_username, app_password_encrypted FROM repositories WHERE clerk_user_id = ? ORDER BY id DESC",
            (user_id,),
        ).fetchall()

    results: list[RepositoryReviews] = []
    for row in rows:
        try:
            results.append(await build_repository_reviews(row))
        except HTTPException:
            # Skip repositories whose token is missing/invalid rather than failing the whole aggregate.
            continue
    return results


@app.get(
    "/api/repositories/credentials",
    response_model=RepositoryCredentials,
    tags=["Repositories"],
    summary="Fetch decrypted GitHub credentials for a registered repository",
    description="Internal endpoint for the n8n PR Reviewer workflow only. Requires the X-Internal-Token header.",
    response_description="The repository's GitHub username and decrypted personal access token.",
    responses={
        401: {"description": "Missing or invalid X-Internal-Token header."},
        404: {"description": "Repository not found."},
        500: {"description": "Failed to decrypt the stored token."},
        503: {"description": "N8N_INTERNAL_TOKEN is not configured."},
    },
)
async def get_repository_credentials(
    full_name: str,
    x_internal_token: str = Header(default=""),
    authorization: str = Header(default=""),
) -> RepositoryCredentials:
    expected_token = os.getenv("N8N_INTERNAL_TOKEN")
    if not expected_token:
        raise HTTPException(status_code=503, detail="N8N_INTERNAL_TOKEN is not configured.")

    token = x_internal_token
    if not token and authorization:
        token = authorization.replace("Bearer ", "").strip()

    if not token or not secrets.compare_digest(token, expected_token):
        raise HTTPException(status_code=401, detail="Missing or invalid X-Internal-Token header.")

    clean_name = full_name.strip().rstrip("/")
    if "github.com/" in clean_name:
        clean_name = clean_name.split("github.com/")[-1]

    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        repo = connection.execute(
            """
            SELECT github_username, app_password_encrypted 
            FROM repositories 
            WHERE full_name = ? COLLATE NOCASE
               OR repository_url LIKE ? COLLATE NOCASE
            LIMIT 1
            """,
            (clean_name, f"%{clean_name}"),
        ).fetchone()

    if not repo:
        raise HTTPException(status_code=404, detail=f"Repository '{full_name}' not found.")
    if not repo["app_password_encrypted"]:
        raise HTTPException(status_code=400, detail="Repository token is not available. Please re-register the repository.")

    try:
        pat = decrypt_token(repo["app_password_encrypted"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to decrypt repository token.") from exc

    return RepositoryCredentials(github_username=repo["github_username"], github_pat=pat)


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
async def send_kt_chat_query(payload: ChatRequest, user_id: str = Depends(get_current_user_id)) -> ChatResponseStatus:
    n8n_webhook_url = os.getenv("N8N_KT_CHAT_WEBHOOK_URL")
    if not n8n_webhook_url:
        raise HTTPException(status_code=503, detail="N8N_KT_CHAT_WEBHOOK_URL is not configured.")

    backend_base = os.getenv("BACKEND_BASE_URL", "http://192.168.1.104:1806").rstrip("/")
    callback_url = f"{backend_base}/api/kt/chat/callback"

    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        repo = connection.execute(
            "SELECT id, repository_url, github_username, app_password_encrypted FROM repositories WHERE id = ? AND clerk_user_id = ?",
            (payload.repository_id, user_id),
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
        "query": payload.query,
        "repoUrl": repo["repository_url"],
        "username": repo["github_username"],
        "pat": pat,
        "sessionId": payload.session_id,
        "callbackUrl": callback_url,
    }

    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
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
async def kt_chat_callback(callback: ChatCallback, x_internal_token: str = Header(default="")) -> dict[str, str]:
    expected_token = os.getenv("N8N_INTERNAL_TOKEN")
    if not expected_token or not secrets.compare_digest(x_internal_token, expected_token):
        raise HTTPException(status_code=401, detail="Missing or invalid X-Internal-Token header.")
        
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
async def get_chat_messages(session_id: str, user_id: str = Depends(get_current_user_id)) -> list[ChatMessageItem]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        # Verify ownership by joining with repositories
        rows = connection.execute(
            """
            SELECT c.id, c.repository_id, c.session_id, c.role, c.content, c.status, c.created_at
            FROM chat_messages c
            JOIN repositories r ON c.repository_id = r.id
            WHERE c.session_id = ? AND r.clerk_user_id = ?
            ORDER BY c.id ASC
            """,
            (session_id, user_id),
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
async def list_chat_sessions(repository_id: int, user_id: str = Depends(get_current_user_id)) -> list[ChatSessionItem]:
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        
        # Check ownership
        repo = connection.execute("SELECT id FROM repositories WHERE id = ? AND clerk_user_id = ?", (repository_id, user_id)).fetchone()
        if not repo:
            raise HTTPException(status_code=404, detail="Repository not found.")

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

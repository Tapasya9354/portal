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
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

load_dotenv()

app = FastAPI(
    title="PR Reviewer Portal API",
    description="Verify and register GitHub repositories for the PR Reviewer backend.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    openapi_tags=[
        {"name": "System", "description": "Service health and readiness endpoints."},
        {"name": "Repositories", "description": "GitHub repository registration and verification."},
    ],
)
cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173,https://prreviewer.nik-server.in")
cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RepositoryRegistration(BaseModel):
    """Credentials used to register a GitHub repository."""

    repository_url: str = Field(min_length=1)
    github_username: str = Field(min_length=1, max_length=100)
    github_app_password: str = Field(min_length=1, description="GitHub App password. It is never returned by the API.")

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
        columns = {row[1] for row in connection.execute("PRAGMA table_info(repositories)")}
        if "rules_json" in columns:
            connection.execute("ALTER TABLE repositories DROP COLUMN rules_json")
        if "password_hash" in columns and "app_password_hash" not in columns:
            connection.execute("ALTER TABLE repositories RENAME COLUMN password_hash TO app_password_hash")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS repositories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repository_url TEXT NOT NULL UNIQUE,
                full_name TEXT NOT NULL,
                github_username TEXT NOT NULL,
                app_password_hash TEXT NOT NULL,
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

            # config.json/index.json are refreshed every registration; the rules files are only seeded once so manual edits stick.
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


async def store_registration(registration: RepositoryRegistration, full_name: str) -> None:
    try:
        with sqlite3.connect(DATABASE_PATH) as connection:
            connection.execute(
                """
                INSERT INTO repositories (repository_url, full_name, github_username, app_password_hash)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(repository_url) DO UPDATE SET
                    full_name = excluded.full_name,
                    github_username = excluded.github_username,
                    app_password_hash = excluded.app_password_hash
                """,
                (
                    registration.repository_url,
                    full_name,
                    registration.github_username,
                    hash_app_password(registration.github_app_password),
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
        502: {"description": "GitHub could not be reached."},
        503: {"description": "Repository verification succeeded, but database storage failed."},
    },
)
async def register_repository(registration: RepositoryRegistration) -> RepositoryResponse:
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
    await store_registration(registration, full_name)
    return RepositoryResponse(repository_url=registration.repository_url, full_name=full_name, registered_at=datetime.now(timezone.utc), github_status=github_status, message="Repository verified and registered.")

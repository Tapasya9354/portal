from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import secrets
import sqlite3
from urllib.parse import urlparse

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
cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173")
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
    await store_registration(registration, full_name)
    return RepositoryResponse(repository_url=registration.repository_url, full_name=full_name, registered_at=datetime.now(timezone.utc), github_status=github_status, message="Repository verified and registered.")

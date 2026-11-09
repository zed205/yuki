-- ============================================================================
-- YukiWeb SQLite Schema
-- ============================================================================
-- Core database for YukiWeb's migration from file-based JSON storage.
-- All timestamps stored as Unix epoch seconds (INTEGER), NOT ISO strings.
-- ============================================================================

-- Migration tracking table — ensures idempotent runs
CREATE TABLE IF NOT EXISTS _migration_state (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL
);

-- --------------------------------------------------------------------------
-- sessions
-- One row per conversation session.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id                 TEXT PRIMARY KEY,
    title              TEXT,
    summary            TEXT,
    project_id         TEXT,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    thinking_enabled   INTEGER DEFAULT 0,
    voice_mode         INTEGER DEFAULT 0,
    disabled_tools     TEXT,           -- JSON array of disabled tool names
    chars_per_token    REAL,
    last_prompt_tokens INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- --------------------------------------------------------------------------
-- messages
-- All messages within a session (user, assistant, tool, system).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    role                TEXT NOT NULL,  -- 'user', 'assistant', 'system', 'tool'
    content             TEXT,
    timestamp           INTEGER NOT NULL,
    tool_calls          TEXT,           -- JSON array of tool call objects
    reasoning_content   TEXT,
    images              TEXT,           -- JSON array of image data URLs
    attachments         TEXT,           -- JSON array of attachment objects
    pruned              INTEGER DEFAULT 0,
    compacted           INTEGER DEFAULT 0,
    synthetic_prefix    TEXT,           -- request-time text prepended to this message (plan snapshot); persisted so replays stay byte-identical
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- --------------------------------------------------------------------------
-- projects
-- User-created projects / workspaces.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- --------------------------------------------------------------------------
-- plans
-- One plan per session, keyed by session_id (acts as PK).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    session_id  TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    steps       TEXT NOT NULL,        -- JSON array of step objects
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- --------------------------------------------------------------------------
-- memories
-- Key-value store for persistent short-term memory.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- --------------------------------------------------------------------------
-- skills
-- Skills stored by name (PK).  Instructions loaded from .md files.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
    name        TEXT PRIMARY KEY,
    description TEXT,
    instructions TEXT
);

-- --------------------------------------------------------------------------
-- mcp_servers
-- MCP server definitions from config.mcpServers.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_servers (
    name    TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    args    TEXT,           -- JSON array of string arguments
    env     TEXT,           -- JSON object of environment variables
    enabled INTEGER DEFAULT 1  -- 1 = enabled, 0 = disabled
);

-- --------------------------------------------------------------------------
-- attachments
-- Individual file attachments linked to a session/message.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
    id          TEXT PRIMARY KEY,
    session_id  TEXT,
    message_id  TEXT,
    name        TEXT NOT NULL,
    type        TEXT,
    path        TEXT,
    size        INTEGER,
    is_image    INTEGER DEFAULT 0
);

-- --------------------------------------------------------------------------
-- llm_logs
-- Raw LLM request/response logs (migrated from llm-raw.log).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id        TEXT,
    timestamp         INTEGER NOT NULL,
    model             TEXT,
    prompt_tokens     INTEGER,
    response_tokens   INTEGER,
    duration_ms       INTEGER,
    request           TEXT,   -- JSON
    response          TEXT,   -- JSON
    error             TEXT
);

-- ============================================================================
-- Indexes for query performance
-- ============================================================================

-- Messages: fast lookup by session with chronological ordering
CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp
    ON messages(session_id, timestamp);

-- Sessions: project-based queries
CREATE INDEX IF NOT EXISTS idx_sessions_project_id
    ON sessions(project_id);

-- Sessions: sort by last activity (most recent first)
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
    ON sessions(updated_at DESC);

-- Attachments: lookup by session
CREATE INDEX IF NOT EXISTS idx_attachments_session_id
    ON attachments(session_id);

-- LLM logs: session-based queries with time ordering
CREATE INDEX IF NOT EXISTS idx_llm_logs_session_timestamp
    ON llm_logs(session_id, timestamp);

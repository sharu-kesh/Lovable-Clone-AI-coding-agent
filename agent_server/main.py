import os
import json
import asyncio
from dotenv import load_dotenv

# Auto-copy .env.example to .env if missing (in case user edited .env.example directly)
base_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(base_dir, ".env")
env_example_path = os.path.join(base_dir, ".env.example")
if not os.path.exists(env_path) and os.path.exists(env_example_path):
    import shutil
    try:
        shutil.copy(env_example_path, env_path)
        print("Auto-created .env by copying .env.example")
    except Exception as e:
        print(f"Warning: Failed to auto-copy .env file: {e}")

load_dotenv(dotenv_path=env_path) # Load environment variables from .env file

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import io
import zipfile
import re

# Import our custom components
from sandbox import SandboxManager
from llm_client import LLMClient
from orchestrator import Orchestrator

app = FastAPI(title="Lovable Clone AI Coding Agent API")

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize singletons
# Projects are scaffolded inside a root 'sandbox' folder
base_dir = os.path.dirname(os.path.abspath(__file__))
SANDBOX_PATH = os.path.abspath(os.path.join(base_dir, "..", "sandbox"))
sandbox_mgr = SandboxManager(SANDBOX_PATH)
llm_client = LLMClient()
orchestrator = Orchestrator(sandbox_mgr, llm_client)

# Pydantic models for request bodies
class ChatRequest(BaseModel):
    session_id: str
    message: str
    provider: Optional[str] = None
    model: Optional[str] = None
    current_file: Optional[str] = None  # for /file and /run slash commands

class CommandRequest(BaseModel):
    session_id: str
    command: str
    current_file: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None

class PlanApprovalRequest(BaseModel):
    session_id: str
    approved: bool
    feedback: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None

class DiffApprovalRequest(BaseModel):
    session_id: str
    approved: bool
    feedback: Optional[str] = None
    custom_replace_block: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None

# --- API Endpoints ---

@app.get("/api/queue-status")
def queue_status_endpoint():
    """
    Returns the live state of the global LLM circuit-breaker queue.
    Shows which models are available now, which are cooling down, and their TTL.
    Useful for debugging rate limit behaviour.
    """
    return {"queue": llm_client.queue_status()}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """
    Smart-routing chat interface:
    - Slash commands (/repo, /file, etc.) → handled immediately via quick execute
    - Simple code requests → single LLM call, inline response + silent file write
    - Complex project tasks → Plan → Checklist → Approve → Execute loop
    """
    from orchestrator import classify_intent
    session = orchestrator.get_or_create_session(req.session_id)
    intent = classify_intent(req.message)

    # ── Slash command ────────────────────────────────────────────────────────
    if intent == "command":
        async def command_stream():
            try:
                yield f"data: {json.dumps({'type': 'status', 'message': f'Running {req.message.split()[0]}...'})}\n\n"
                result = await orchestrator.execute_slash_command(
                    req.session_id, req.message, req.current_file, req.provider, req.model
                )
                yield f"data: {json.dumps({'type': 'quick_response', 'content': result})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return StreamingResponse(command_stream(), media_type="text/event-stream")

    # ── Plan Approval/Rejection via Chat Text ────────────────────────────────
    # The persisted state is the source of truth.  Looking for words such as
    # "plan" in the last assistant message misclassified normal follow-up
    # requests as plan feedback after an app had already been built.
    is_plan_pending = session.status == "planning"
    if is_plan_pending:
        approval_keywords = {"implement", "proceed", "approve", "start", "go", "yes", "ok", "run", "do"}
        # Use the incoming chat text.  This used to reference an undefined
        # variable named `msg`, which stopped the request before the coding
        # stream could start when a user typed "implement".
        msg_words = set(re.sub(r"[^a-z\s]", "", req.message.lower()).split())
        is_approval = any(kw in msg_words for kw in approval_keywords)

        if is_approval:
            session.status = "executing"
            orchestrator.save_session_to_disk(req.session_id)
            async def execute_stream():
                try:
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Executing coding steps...'})}\n\n"
                    async for step in orchestrator.execute_coding_step(
                        session_id=req.session_id,
                        user_approval_message=f"Plan approved via chat. User message: {req.message}",
                        provider=req.provider,
                        model=req.model
                    ):
                        yield f"data: {json.dumps(step)}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return StreamingResponse(execute_stream(), media_type="text/event-stream")
        else:
            # Regenerate plan based on chat comments
            async def regenerate_plan_stream():
                try:
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Regenerating plan based on comments...'})}\n\n"
                    feedback_prompt = f"User feedback on proposed plan: {req.message}. Please revise the checklist."
                    plan = await orchestrator.generate_plan(
                        req.session_id, feedback_prompt, req.provider, req.model
                    )
                    yield f"data: {json.dumps({'type': 'plan', 'content': plan})}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'message': 'Awaiting Plan Approval'})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return StreamingResponse(regenerate_plan_stream(), media_type="text/event-stream")

    # ── Active project follow-up: directly execute coding step ────────────────
    if session.plan:
        async def execute_stream():
            try:
                yield f"data: {json.dumps({'type': 'status', 'message': 'Executing coding steps...'})}\n\n"
                async for step in orchestrator.execute_coding_step(
                    session_id=req.session_id,
                    user_approval_message=req.message,
                    provider=req.provider,
                    model=req.model
                ):
                    yield f"data: {json.dumps(step)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return StreamingResponse(execute_stream(), media_type="text/event-stream")

    # ── Simple code ──────────────────────────────────────────────────────────
    if intent == "simple":
        async def quick_stream():
            try:
                yield f"data: {json.dumps({'type': 'status', 'message': 'Generating code...'})}\n\n"
                result = await orchestrator.quick_code(
                    req.session_id, req.message, req.provider, req.model
                )
                yield f"data: {json.dumps({'type': 'quick_response', 'content': result})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        return StreamingResponse(quick_stream(), media_type="text/event-stream")

    # ── Complex: generate plan first ─────────────────────────────────────────
    async def plan_stream():
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': 'Generating plan...'})}\n\n"
            plan = await orchestrator.generate_plan(
                req.session_id, req.message, req.provider, req.model
            )
            yield f"data: {json.dumps({'type': 'plan', 'content': plan})}\n\n"
            yield f"data: {json.dumps({'type': 'status', 'message': 'Awaiting Plan Approval'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(plan_stream(), media_type="text/event-stream")


@app.post("/api/command")
async def command_endpoint(req: CommandRequest):
    """Dedicated endpoint for slash commands."""
    async def stream():
        try:
            yield f"data: {json.dumps({'type': 'status', 'message': f'Running {req.command.split()[0]}...'})}\n\n"
            result = await orchestrator.execute_slash_command(
                req.session_id, req.command, req.current_file, req.provider, req.model
            )
            yield f"data: {json.dumps({'type': 'quick_response', 'content': result})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/approve_plan")
async def approve_plan_endpoint(req: PlanApprovalRequest):
    """
    User plan approval endpoint.
    If approved: starts scaffolding React project.
    If rejected: sends user comments back to LLM to regenerate plan.
    """
    session = orchestrator.get_or_create_session(req.session_id)

    if not req.approved:
        # User wants plan changes: regenerate plan with feedback comments
        async def regenerate_plan_stream():
            try:
                yield f"data: {json.dumps({'type': 'status', 'message': 'Regenerating plan based on comments...'})}\n\n"
                feedback_prompt = f"User feedback on proposed plan: {req.feedback}. Please revise the checklist."
                plan = await orchestrator.generate_plan(
                    req.session_id, feedback_prompt, req.provider, req.model
                )
                yield f"data: {json.dumps({'type': 'plan', 'content': plan})}\n\n"
                yield f"data: {json.dumps({'type': 'status', 'message': 'Awaiting Plan Approval'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        
        return StreamingResponse(regenerate_plan_stream(), media_type="text/event-stream")

    # User Approved: Trigger the agent execution loop
    # Persist the transition immediately so a refresh (or a second request)
    # cannot treat the already-approved plan as still awaiting approval.
    session.status = "executing"
    orchestrator.save_session_to_disk(req.session_id)

    async def execute_stream():
        try:
            async for step in orchestrator.execute_coding_step(
                session_id=req.session_id,
                user_approval_message="Plan approved. Please proceed to write code.",
                provider=req.provider,
                model=req.model
            ):
                yield f"data: {json.dumps(step)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(execute_stream(), media_type="text/event-stream")


@app.post("/api/approve_diff")
async def approve_diff_endpoint(req: DiffApprovalRequest):
    """
    Option B endpoint: Resolves the paused code edit.
    Receives user decision (approve, edit, or reject) and continues the stream.
    """
    async def resolve_stream():
        try:
            async for step in orchestrator.resolve_pending_diff(
                session_id=req.session_id,
                approved=req.approved,
                feedback=req.feedback,
                custom_replace_block=req.custom_replace_block,
                provider=req.provider,
                model=req.model
            ):
                yield f"data: {json.dumps(step)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(resolve_stream(), media_type="text/event-stream")


@app.post("/api/interrupt")
async def interrupt_endpoint(req: dict):
    """
    Immediately interrupts any in-progress agent execution for a session.
    Sets the session status back to 'idle' and appends a cancellation notice to history.
    The streaming generator checks this flag and stops yielding new steps.
    """
    session_id = req.get("session_id", "")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    session = orchestrator.get_or_create_session(session_id)
    if session.status in ("executing", "planning"):
        session.status = "idle"
        session.history.append({
            "role": "assistant",
            "content": "⛔ Generation stopped by user."
        })
        orchestrator.save_session_to_disk(session_id)
        return {"ok": True, "message": "Agent interrupted successfully."}

    return {"ok": True, "message": f"Agent was not running (status: {session.status})."}


@app.get("/api/sessions")
def get_sessions_endpoint():
    """
    Returns list of saved sessions with id and display name.
    """
    session_ids = orchestrator.list_saved_sessions()
    result = []
    for sid in session_ids:
        sess = orchestrator.get_or_create_session(sid)
        result.append({
            "id": sid,
            "display_name": sess.display_name or sid,
            "project_dir": sess.project_dir,
        })
    return {"sessions": result}

class RenameSessionRequest(BaseModel):
    display_name: str

@app.patch("/api/session/{session_id}/rename")
def rename_session_endpoint(session_id: str, req: RenameSessionRequest):
    """
    Sets a human-readable display name for a session.
    Stored in session.display_name and persisted to disk.
    """
    if not req.display_name.strip():
        raise HTTPException(status_code=400, detail="display_name cannot be empty")
    session = orchestrator.get_or_create_session(session_id)
    session.display_name = req.display_name.strip()
    orchestrator.save_session_to_disk(session_id)
    return {"status": "success", "display_name": session.display_name}


@app.get("/api/session/{session_id}")
def get_session_details(session_id: str):
    """
    Retrieves full details of a specific session.
    """
    session = orchestrator.get_or_create_session(session_id)
    return session.to_dict()


@app.delete("/api/session/{session_id}")
def delete_session_endpoint(session_id: str):
    """
    Permanently deletes a saved chat session from disk.
    """
    try:
        # Resolve filepath
        filepath = os.path.join(orchestrator.sessions_dir, f"{session_id}.json")
        if os.path.exists(filepath):
            os.remove(filepath)
        # Clear from RAM cache
        if session_id in orchestrator.sessions:
            del orchestrator.sessions[session_id]
        return {"status": "success", "message": f"Session '{session_id}' deleted."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sandbox/files")
def get_sandbox_files():
    """
    Returns file structure of the sandbox for the file tree viewer.
    """
    return orchestrator.tools.get_repo_map()


@app.get("/api/sandbox/file")
def get_sandbox_file_content(path: str = Query(..., description="Relative path in sandbox")):
    """
    Reads code of a specific file for the editor workspace.
    """
    content = orchestrator.tools.read_file(path)
    if content.startswith("Error"):
        raise HTTPException(status_code=400, detail=content)
    return {"content": content}


class WriteFileRequest(BaseModel):
    path: str
    content: str

@app.post("/api/sandbox/file")
def write_sandbox_file_endpoint(req: WriteFileRequest):
    """
    Overwrites/saves the updated text content to a file inside the sandbox disk.
    """
    try:
        res = orchestrator.tools.write_file(req.path, req.content)
        if res.startswith("Error"):
            raise HTTPException(status_code=400, detail=res)
        return {"status": "success", "message": f"File '{req.path}' saved."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class UploadTreeRequest(BaseModel):
    files: List[Dict[str, str]]  # List of {"path": relative_path, "content": file_content}
    clear_existing: Optional[bool] = False

@app.post("/api/sandbox/upload_tree")
async def upload_tree_endpoint(req: UploadTreeRequest):
    """
    Receives local folder/files upload from the frontend and writes them to the sandbox workspace.
    Supports clearing the existing workspace directory first.
    """
    try:
        # Wipe sandbox if requested (Open in New Window)
        if req.clear_existing:
            import shutil
            logger.info("Clearing sandbox workspace for new project import...")
            for item in os.listdir(sandbox_mgr.base_dir):
                item_path = os.path.join(sandbox_mgr.base_dir, item)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                except Exception as e:
                    logger.warning(f"Could not delete {item_path}: {e}")

        # Write new files to sandbox
        for f in req.files:
            path = f["path"].replace("\\", "/").strip("/")
            content = f["content"]
            orchestrator.tools.write_file(path, content)
        return {"status": "success", "message": f"Uploaded {len(req.files)} files to sandbox."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DeletePathRequest(BaseModel):
    path: str

@app.post("/api/sandbox/delete")
async def delete_sandbox_path(req: DeletePathRequest):
    """
    Permanently deletes a file or folder from the sandbox disk.
    """
    try:
        full_path = sandbox_mgr.safe_resolve(req.path)
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail=f"Path '{req.path}' does not exist.")
        
        if os.path.isdir(full_path):
            import shutil
            shutil.rmtree(full_path)
        else:
            os.remove(full_path)
        return {"status": "success", "message": f"Deleted '{req.path}' from disk."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TerminalRunRequest(BaseModel):
    terminal_id: str
    command: str
    project_dir: Optional[str] = None

class TerminalCreateRequest(BaseModel):
    terminal_id: str

class TerminalKillRequest(BaseModel):
    terminal_id: str


@app.get("/api/sandbox/terminal/logs")
async def get_terminal_logs_endpoint(terminal_id: str = Query(..., description="ID of the terminal session")):
    """
    Retrieves logs and running state for a specific terminal session.
    """
    logs, is_running = await sandbox_mgr.get_terminal_logs(terminal_id)
    return {"logs": logs, "is_running": is_running}


@app.post("/api/sandbox/terminal/create")
async def create_terminal_endpoint(req: TerminalCreateRequest):
    """
    Creates a new terminal session instance.
    """
    await sandbox_mgr.create_terminal(req.terminal_id)
    return {"status": "success", "message": f"Terminal '{req.terminal_id}' created."}


@app.post("/api/sandbox/terminal/run")
async def run_terminal_command_endpoint(req: TerminalRunRequest):
    """
    Runs a shell command asynchronously in the background for a specific terminal.
    """
    await sandbox_mgr.run_command_in_terminal(req.terminal_id, req.command, req.project_dir)
    return {"status": "success", "message": "Command started in background."}


@app.post("/api/sandbox/terminal/kill")
async def kill_terminal_endpoint(req: TerminalKillRequest):
    """
    Abruptly terminates the active process running in a terminal session.
    """
    await sandbox_mgr.kill_terminal(req.terminal_id)
    return {"status": "success", "message": f"Terminal '{req.terminal_id}' process killed."}


@app.post("/api/sandbox/terminal/delete")
async def delete_terminal_endpoint(req: TerminalKillRequest):
    """
    Kills and deletes the terminal session from memory.
    """
    await sandbox_mgr.delete_terminal(req.terminal_id)
    return {"status": "success", "message": f"Terminal '{req.terminal_id}' deleted."}



@app.get("/api/sandbox/export/{project_dir}")
def export_project_zip(project_dir: str):
    """
    Streams a ZIP archive of the given project subdirectory inside sandbox/.
    The ZIP preserves the folder structure relative to sandbox/<project_dir>/.
    """
    # Safety: only allow simple folder names (no path traversal)
    if not re.match(r'^[a-zA-Z0-9_\-]+$', project_dir):
        raise HTTPException(status_code=400, detail="Invalid project directory name.")

    project_path = os.path.join(sandbox_mgr.base_dir, project_dir)
    if not os.path.exists(project_path):
        raise HTTPException(status_code=404, detail=f"Project '{project_dir}' not found in sandbox.")

    # Build the ZIP in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(project_path):
            # Skip node_modules and dist to keep the zip small
            dirs[:] = [d for d in dirs if d not in ("node_modules", "dist", ".git", "__pycache__")]
            for file in files:
                abs_path = os.path.join(root, file)
                # Store path relative to the project root inside the zip
                rel_path = os.path.relpath(abs_path, project_path)
                zf.write(abs_path, arcname=os.path.join(project_dir, rel_path))

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={project_dir}.zip"}
    )


@app.post("/api/sandbox/clean")
async def clean_port():
    """
    Stops dev server and cleans port 5173.
    """
    await sandbox_mgr.terminate_background_processes()
    await sandbox_mgr.clean_port(5173)
    return {"status": "success", "message": "Port cleaned and active servers terminated."}


@app.on_event("shutdown")
async def shutdown_event():
    """
    Cleans up any dangling dev servers when the server stops.
    """
    await sandbox_mgr.terminate_background_processes()

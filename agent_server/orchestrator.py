import json
import os
import re
import asyncio
from typing import Dict, List, Any, Optional, AsyncGenerator, Tuple
from sandbox import SandboxManager
from tools import AgentTools
from llm_client import LLMClient
import logging

logger = logging.getLogger("orchestrator")

PLANNING_SYSTEM_PROMPT = """You are the Architect and Planner Agent.
Your job is to read the user request, inspect the current workspace file tree, and generate a clear, step-by-step Technical Implementation Plan.

Do not write code yet. Instead, write a detailed checklist of:
1. Necessary npm libraries to install.
2. New component files to create (specify path and brief purpose).
3. Files that need modification.

Provide the response in clear, structured Markdown. Ensure you use bullet points and checklist format so it can be easily read by the user.
"""

CODING_SYSTEM_PROMPT = """You are the Execution Coding Agent.
Your task is to implement the approved plan. You have access to tools to read/write files, inspect the workspace, and run terminal commands in the sandbox.

Follow these rules:
1. Always scaffold a React project using Vite if the sandbox is empty. To run this non-interactively on a non-empty directory, run exactly: `npm create vite@latest . -- --template react --overwrite`. Do NOT run interactive setup commands that wait for user prompts.
2. Run `npm install` and install any needed packages (like `lucide-react`, `tailwind-scrollbar`, etc.).
3. Write modular, clean, and modern React components.
4. IMPORTANT: To modify existing files, always prefer 'edit_file_diff' over overwriting the file. This reduces cost and execution time.
5. After modifying files or running builds, make sure you start the dev server ('npm run dev') in the background to preview the changes.
6. If a terminal command fails or a compiler error occurs, read the logs and correct your code.
7. Explain what you are doing in short, user-facing status messages.
"""

QUICK_CODE_SYSTEM_PROMPT = """You are a concise, expert coding assistant.
The user wants a quick code solution. Respond ONLY with:
1. A single brief sentence explaining what the code does.
2. The complete, runnable code in a properly fenced markdown code block.
3. A single brief sentence on how to run it (if applicable).

Do NOT write lengthy explanations, multiple approaches, or ask questions. Be direct and precise.
"""

# ─── Intent Classification ───────────────────────────────────────────────────

# Patterns that indicate a simple, direct-code request (like Claude Code inline)
SIMPLE_CODE_PATTERNS = [
    r"^(write|give|show|create|generate|make)\s+(me\s+)?(a\s+)?(simple\s+)?(python|java|javascript|js|typescript|ts|c\+\+|cpp|c|go|rust|ruby|kotlin|swift)\s+(code|script|program|function|class|snippet)",
    r"(python|java|javascript|typescript|go|rust)\s+(code|script|function|class)\s+(to|for|that|which)",
    r"^how\s+(do\s+i|to)\s+(implement|write|code|create|build)",
    r"^(implement|code)\s+(a\s+)?(function|method|class|algorithm|solution)",
    r"(sort|search|merge|reverse|fibonacci|factorial|palindrome|prime|binary|linked.?list|stack|queue|tree|graph)\s+(algorithm|code|in|using|with)",
    r"^(fix|debug|explain|refactor|optimize)\s+(this|my|the)\s+(code|function|class|script)",
]

# Patterns that definitely require a full Plan → Execute loop
COMPLEX_PATTERNS = [
    r"\b(build|scaffold|create|setup|initialize)\s+(a|an|the|full|complete|entire)\s+(app|application|project|website|web.?app|clone|dashboard|platform|system)",
    r"\b(notion|trello|slack|twitter|github|figma|shopify)\s+clone",
    r"\b(full.?stack|frontend|backend|react|next\.?js|vite)\s+(app|project|application)",
    r"\b(install|setup|configure)\s+(the\s+)?(dependencies|packages|environment|project)",
    r"\bscaffold\b",
    r"\bmulti.?page\b",
]

def classify_intent(message: str) -> str:
    """
    Classifies user message intent:
    - 'simple'  → quick inline code response + silent file write
    - 'complex' → full Plan → Checklist → Approve → Execute loop
    - 'command' → slash command (handled separately)
    """
    msg = message.strip().lower()

    if msg.startswith("/"):
        return "command"

    for pattern in COMPLEX_PATTERNS:
        if re.search(pattern, msg, re.IGNORECASE):
            return "complex"

    for pattern in SIMPLE_CODE_PATTERNS:
        if re.search(pattern, msg, re.IGNORECASE):
            return "simple"

    # Default: if message is short (under 12 words) and doesn't mention "build", treat as simple
    word_count = len(msg.split())
    if word_count <= 15 and not any(kw in msg for kw in ["build", "scaffold", "app", "project", "full"]):
        return "simple"

    return "complex"

class AgentSession:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.history: List[Dict[str, Any]] = []
        self.plan: Optional[str] = None
        self.pending_tool_call: Optional[Dict[str, Any]] = None
        self.status: str = "idle"  # idle, planning, executing, paused_for_diff
        # Named subdirectory inside sandbox/ where this project lives.
        # e.g. "notion-clone" -> all files go under sandbox/notion-clone/
        self.project_dir: str = ""
        # Optional human-readable name set by the user via rename
        self.display_name: str = ""
        # Tracks consecutive terminal error count for auto-fix loop
        self.consecutive_errors: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "history": self.history,
            "plan": self.plan,
            "pending_tool_call": self.pending_tool_call,
            "status": self.status,
            "project_dir": self.project_dir,
            "display_name": self.display_name,
            "consecutive_errors": self.consecutive_errors,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentSession":
        session = cls(data["session_id"])
        session.history = data.get("history", [])
        session.plan = data.get("plan")
        session.pending_tool_call = data.get("pending_tool_call")
        session.status = data.get("status", "idle")
        session.project_dir = data.get("project_dir", "")
        session.display_name = data.get("display_name", "")
        session.consecutive_errors = data.get("consecutive_errors", 0)
        return session

class Orchestrator:
    def __init__(self, sandbox: SandboxManager, llm: LLMClient, sessions_dir: str = ".sessions"):
        self.sandbox = sandbox
        self.llm = llm
        self.tools = AgentTools(sandbox)
        self.sessions: Dict[str, AgentSession] = {}
        
        # Resolve persistent sessions directory path
        self.sessions_dir = os.path.abspath(sessions_dir)
        os.makedirs(self.sessions_dir, exist_ok=True)

    def get_or_create_session(self, session_id: str) -> AgentSession:
        """
        Retrieves session from RAM cache, or loads it from disk, or creates a new one.
        """
        # Case 1: In-RAM Cache (Fastest)
        if session_id in self.sessions:
            return self.sessions[session_id]

        # Case 2: Load from disk
        filepath = os.path.join(self.sessions_dir, f"{session_id}.json")
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                session = AgentSession.from_dict(data)
                self.sessions[session_id] = session
                logger.info(f"Loaded session '{session_id}' from disk cache.")
                return session
            except Exception as e:
                logger.error(f"Failed loading session '{session_id}' from disk: {e}")

        # Case 3: Create new session
        session = AgentSession(session_id)
        self.sessions[session_id] = session
        self.save_session_to_disk(session_id)
        return session

    def save_session_to_disk(self, session_id: str):
        """
        Saves session data to disk to free up memory or persist across restarts.
        """
        if session_id not in self.sessions:
            return
        session = self.sessions[session_id]
        filepath = os.path.join(self.sessions_dir, f"{session_id}.json")
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(session.to_dict(), f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save session '{session_id}' to disk: {e}")

    def list_saved_sessions(self) -> List[str]:
        """
        Returns list of session_ids available on disk for the frontend sidebar,
        sorted chronologically (latest modified session first).
        """
        sessions_with_time = []
        try:
            if os.path.exists(self.sessions_dir):
                for filename in os.listdir(self.sessions_dir):
                    if filename.endswith(".json") and filename != "cooldowns.json":
                        filepath = os.path.join(self.sessions_dir, filename)
                        mtime = os.path.getmtime(filepath)
                        sessions_with_time.append((filename[:-5], mtime))
                
                # Sort by mtime descending (latest modified first)
                sessions_with_time.sort(key=lambda x: x[1], reverse=True)
        except Exception as e:
            logger.error(f"Error listing sessions: {e}")
        return [s[0] for s in sessions_with_time]

    async def quick_code(
        self,
        session_id: str,
        user_message: str,
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> str:
        """
        Like Claude Code's inline response for simple tasks.
        Makes a single LLM call, returns code inline in chat,
        and silently writes any generated code file to the sandbox.
        """
        session = self.get_or_create_session(session_id)
        session.status = "coding"
        self.save_session_to_disk(session_id)

        # Include recent history for context (last 6 messages max)
        recent_history = session.history[-6:] if len(session.history) > 6 else session.history

        messages = [
            {"role": "system", "content": QUICK_CODE_SYSTEM_PROMPT},
            *recent_history,
            {"role": "user", "content": user_message}
        ]

        logger.info(f"Quick code response for session {session_id}")
        response = await self.llm.chat_completion(
            messages,
            preferred_provider=provider,
            preferred_model=model
        )

        reply = response["choices"][0]["message"]["content"] or ""

        # Silently extract code blocks and write them to sandbox
        import re as _re
        code_blocks = _re.findall(r"```(\w+)?\n([\s\S]*?)```", reply)
        for lang, code in code_blocks:
            lang = (lang or "txt").lower()
            ext_map = {
                "python": "py", "java": "java", "javascript": "js",
                "typescript": "ts", "go": "go", "rust": "rs",
                "cpp": "cpp", "c": "c", "ruby": "rb", "kotlin": "kt",
                "swift": "swift", "bash": "sh", "shell": "sh",
            }
            ext = ext_map.get(lang, lang)
            # Derive filename from the prompt (first 4 words)
            words = _re.sub(r"[^a-z0-9\s]", "", user_message.lower()).split()[:4]
            fname = "_".join(words) + f".{ext}" if words else f"snippet.{ext}"
            try:
                self.tools.write_file(fname, code.strip())
                logger.info(f"Silently wrote {fname} to sandbox")
            except Exception as e:
                logger.warning(f"Could not write snippet file: {e}")

        # Persist to session history
        session.history.append({"role": "user", "content": user_message})
        session.history.append({"role": "assistant", "content": reply})
        session.status = "idle"
        self.save_session_to_disk(session_id)

        return reply

    async def execute_slash_command(
        self,
        session_id: str,
        command: str,
        current_file: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> str:
        """
        Executes slash commands like /repo, /file, /run, /explain, /clear, /diff.
        Returns a markdown-formatted response string.
        """
        cmd = command.strip().lower().split()[0]  # e.g. "/repo"

        if cmd == "/repo":
            repo_map = self.tools.get_repo_map()
            repo_str = json.dumps(repo_map.get("repo_map", {}), indent=2)
            messages = [
                {"role": "system", "content": "You are a senior code reviewer. Analyze this repository structure and provide a concise summary of: what this project does, what each file's purpose is, and any architectural observations."},
                {"role": "user", "content": f"Repository structure:\n```json\n{repo_str}\n```\nProvide a clear, structured summary."}
            ]
            resp = await self.llm.chat_completion(messages, preferred_provider=provider, preferred_model=model)
            return resp["choices"][0]["message"]["content"]

        elif cmd == "/file":
            if not current_file:
                return "⚠️ No file is currently open in the editor. Select a file from the file tree first."
            content = self.tools.read_file(current_file)
            if content.startswith("Error:"):
                return f"⚠️ Could not read file: {content}"
            messages = [
                {"role": "system", "content": "You are a senior code reviewer. Analyze the provided file and explain: what it does, key functions/classes, any issues or improvements, and how it fits into the project."},
                {"role": "user", "content": f"File: `{current_file}`\n\n```\n{content[:6000]}\n```\nProvide a clear, structured analysis."}
            ]
            resp = await self.llm.chat_completion(messages, preferred_provider=provider, preferred_model=model)
            return resp["choices"][0]["message"]["content"]

        elif cmd == "/run":
            if not current_file:
                return "⚠️ No file is currently open. Select a file from the file tree first."
            ext = current_file.rsplit(".", 1)[-1].lower()
            run_commands = {
                "py": f"python {current_file}",
                "js": f"node {current_file}",
                "ts": f"npx ts-node {current_file}",
                "java": f"javac {current_file} && java {current_file.replace('.java', '')}",
                "go": f"go run {current_file}",
                "rb": f"ruby {current_file}",
            }
            cmd_str = run_commands.get(ext)
            if not cmd_str:
                return f"⚠️ Don't know how to run `.{ext}` files automatically."
            result = await self.tools.execute_terminal_command(cmd_str)
            output = result.get("stdout", "") or result.get("stderr", "")
            exit_code = result.get("exit_code", -1)
            status = "✅ Success" if exit_code == 0 else f"❌ Failed (exit code {exit_code})"
            return f"**Run:** `{cmd_str}`\n**Status:** {status}\n\n```\n{output[:3000]}\n```"

        elif cmd == "/explain":
            session = self.get_or_create_session(session_id)
            # Find last assistant message with a code block
            last_code = ""
            for msg in reversed(session.history):
                if msg.get("role") == "assistant" and "```" in (msg.get("content") or ""):
                    last_code = msg["content"]
                    break
            if not last_code:
                return "⚠️ No recent code block found in this session to explain."
            messages = [
                {"role": "system", "content": "You are a patient coding teacher. Explain the provided code step by step, in simple language. Cover what each block does, why it's written that way, and any important concepts."},
                {"role": "user", "content": f"Please explain this code step by step:\n\n{last_code}"}
            ]
            resp = await self.llm.chat_completion(messages, preferred_provider=provider, preferred_model=model)
            return resp["choices"][0]["message"]["content"]

        elif cmd == "/clear":
            session = self.get_or_create_session(session_id)
            session.history = []
            session.plan = None
            session.status = "idle"
            self.save_session_to_disk(session_id)
            return "✅ Chat history cleared. Starting fresh."

        elif cmd == "/diff":
            if not current_file:
                return "[WARN] No file selected. Open a file to see its diff."
            content = self.tools.read_file(current_file)
            return f"**Current content of `{current_file}`:**\n\n```\n{content[:4000]}\n```"

        elif cmd == "/export":
            session = self.get_or_create_session(session_id)
            project_dir = session.project_dir or ""
            if not project_dir:
                return (
                    "[WARN] No active project found for this session. "
                    "Start a project first, then use /export to download it."
                )
            return (
                f"Your project is ready to download!\n\n"
                f"Click this link to download the ZIP:\n"
                f"[Download {project_dir}.zip](http://localhost:8000/api/sandbox/export/{project_dir})"
            )

        else:
            return f"[WARN] Unknown command: `{command}`. Available: `/repo`, `/file`, `/run`, `/explain`, `/clear`, `/diff`, `/export`"

    @staticmethod
    def _derive_project_slug(user_message: str) -> str:
        """
        Derives a kebab-case folder name from the user's request.
        e.g. "Build a Notion-style app" -> "notion-app"
             "Create a todo list with React" -> "todo-list"
        Falls back to "my-app" if nothing useful is found.
        """
        # Strip common filler words and punctuation
        filler = {
            "build", "create", "make", "a", "an", "the", "me", "app", "application",
            "web", "react", "with", "using", "in", "for", "that", "style", "like",
            "full", "simple", "basic", "new", "some", "and", "or", "of", "is",
        }
        words = re.sub(r"[^a-z0-9\s]", " ", user_message.lower()).split()
        slug_words = [w for w in words if w not in filler and len(w) > 2]
        slug = "-".join(slug_words[:3]) if slug_words else "my-app"
        return slug[:40]  # cap length

    async def generate_plan(
        self,
        session_id: str,
        user_message: str,
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> str:
        session = self.get_or_create_session(session_id)
        session.status = "planning"

        # Derive and store a named project subdirectory (only on first plan)
        if not session.project_dir:
            session.project_dir = self._derive_project_slug(user_message)
            logger.info(f"Project directory set to: sandbox/{session.project_dir}/")

        self.save_session_to_disk(session_id)
        
        # Gather repo map to feed into plan context
        repo_map = self.tools.get_repo_map()
        repo_map_str = json.dumps(repo_map, indent=2)

        if session.plan:
            # We are revising an existing plan based on feedback
            prompt_content = (
                f"You are the Architect and Planner Agent. The user wants to revise the existing Technical Implementation Plan.\n\n"
                f"Existing Plan:\n```markdown\n{session.plan}\n```\n\n"
                f"User Revision Request: {user_message}\n\n"
                f"Project Directory: sandbox/{session.project_dir}/\n"
                f"Current Repository Structure:\n{repo_map_str}\n\n"
                f"Please update and modify the existing plan, keeping the parts that are unchanged, and incorporating the requested edits/additions. Return the complete updated plan in clear, structured Markdown checklist format."
            )
        else:
            # Generating a brand-new plan
            prompt_content = (
                f"User Request: {user_message}\n"
                f"Project Directory: sandbox/{session.project_dir}/\n"
                f"Current Repository Structure:\n{repo_map_str}"
            )
        
        messages = [
            {"role": "system", "content": PLANNING_SYSTEM_PROMPT},
            {"role": "user", "content": prompt_content}
        ]

        logger.info(f"Generating/Revising plan for session {session_id}")
        response = await self.llm.chat_completion(
            messages,
            preferred_provider=provider,
            preferred_model=model
        )
        
        plan_text = response["choices"][0]["message"]["content"]
        session.plan = plan_text
        
        session.history.append({"role": "user", "content": user_message})
        session.history.append({"role": "assistant", "content": f"Here is my updated proposed plan:\n\n{plan_text}" if session.plan else f"Here is my proposed plan:\n\n{plan_text}"})
        # Keep status as "planning" so the Approve & Build button works immediately
        session.status = "planning"
        
        self.save_session_to_disk(session_id)
        return plan_text

    async def execute_coding_step(
        self, 
        session_id: str,
        user_approval_message: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        session = self.get_or_create_session(session_id)
        
        if user_approval_message:
            session.history.append({"role": "user", "content": user_approval_message})
            self.save_session_to_disk(session_id)
            
        session.status = "executing"
        yield {"type": "status", "message": "Executing coding step..."}
        
        max_iterations = 15
        
        for _ in range(max_iterations):
            # ── Interrupt check — user pressed Stop ──────────────────────────
            if session.status == "idle":
                yield {"type": "interrupted", "message": "⛔ Generation stopped by user."}
                return

            if session.status == "paused_for_diff":
                yield {"type": "status", "message": "Paused. Waiting for diff approval."}
                return

            await self._compress_history_if_needed(session, provider, model)

            # Fetch up-to-date repo structure so the agent knows exactly which files exist
            repo_map = self.tools.get_repo_map()
            repo_map_str = json.dumps(repo_map.get("repo_map", {}), indent=2)

            # Inject project subdirectory context so the agent scopes all work to it
            project_dir = session.project_dir or "my-app"
            project_path_hint = (
                f"\n\nProject Directory: All files for this project MUST be created inside "
                f"'sandbox/{project_dir}/'. When running terminal commands, always set "
                f"cwd_relative to '{project_dir}' so commands execute inside that subfolder. "
                f"Example: to scaffold, run: npm create vite@latest . -- --template react --overwrite "
                f"with cwd_relative='{project_dir}'."
            )

            system_prompt = CODING_SYSTEM_PROMPT + project_path_hint + f"\n\nCurrent Workspace File Tree:\n{repo_map_str}"

            # Strict guardrail: if the project subfolder already has files, forbid re-scaffolding
            project_files = repo_map.get("repo_map", {}).get(project_dir, {})
            if project_files:
                system_prompt += (
                    f"\n\nCRITICAL: The project at sandbox/{project_dir}/ is NOT empty. "
                    "Do NOT run scaffolding commands (like 'npm create vite' or 'npm init'). "
                    "Inspect existing files using read_file/get_repo_map, then edit them "
                    "surgically using edit_file_diff to implement changes or fix errors."
                )

            # Dynamic Rejection Guidance: Prepend strict guardrails if the user just rejected a diff
            last_was_rejection = False
            if session.history and session.history[-1].get("role") == "tool":
                tool_content = str(session.history[-1].get("content", ""))
                if "User rejected this edit" in tool_content:
                    last_was_rejection = True

            if last_was_rejection:
                system_prompt += (
                    "\n\nCRITICAL: The user has rejected your last edit. Read their feedback carefully. "
                    "Do NOT rewrite the entire class, change the algorithm, or modify unrelated code. "
                    "Make a highly targeted, surgical edit to change ONLY the specific variables, arrays, "
                    "or lines requested in their feedback, keeping all other code completely identical."
                )

            messages = [{"role": "system", "content": system_prompt}] + session.history
            
            try:
                response = await self.llm.chat_completion(
                    messages=messages,
                    tools=self.tools.get_tool_definitions(),
                    preferred_provider=provider,
                    preferred_model=model
                )
            except Exception as e:
                yield {"type": "error", "message": f"LLM Call failed: {str(e)}"}
                session.status = "idle"
                self.save_session_to_disk(session_id)
                return

            msg = response["choices"][0]["message"]
            session.history.append(msg)
            self.save_session_to_disk(session_id)

            if msg.get("content"):
                yield {"type": "thought", "message": msg["content"]}

            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                yield {"type": "status", "message": "Coding step completed."}
                session.status = "idle"
                self.save_session_to_disk(session_id)
                return

            for tool_call in tool_calls:
                func_name = tool_call["function"]["name"]
                tool_call_id = tool_call.get("id", "call_1")
                
                try:
                    arguments = json.loads(tool_call["function"]["arguments"])
                except json.JSONDecodeError as jde:
                    logger.warning(f"Malformed JSON arguments generated by LLM: {jde}")
                    session.history.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "name": func_name,
                        "content": f"Error: The arguments you provided for the tool call were not valid JSON: {str(jde)}. Please call the tool again with a valid, correctly escaped JSON string."
                    })
                    self.save_session_to_disk(session_id)
                    continue

                yield {"type": "status", "message": f"Agent wants to call tool '{func_name}'"}

                if func_name == "edit_file_diff":
                    session.status = "paused_for_diff"
                    session.pending_tool_call = {
                        "id": tool_call_id,
                        "name": func_name,
                        "args": arguments
                    }
                    self.save_session_to_disk(session_id)
                    
                    path = arguments.get("path")
                    if session.project_dir and not path.startswith(session.project_dir):
                        path = os.path.join(session.project_dir, path).replace("\\", "/")
                    original_content = self.tools.read_file(path)
                    
                    yield {
                        "type": "pending_diff",
                        "path": path,
                        "search_block": arguments.get("search_block"),
                        "replace_block": arguments.get("replace_block"),
                        "original_content": original_content,
                        "tool_call_id": tool_call_id
                    }
                    return

                # Run other tools (execute command, write file, read file) automatically
                tool_output = await self._execute_tool(func_name, arguments, session_id)
                
                compact_output = self._truncate_tool_output(func_name, tool_output)

                session.history.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": func_name,
                    "content": compact_output
                })
                self.save_session_to_disk(session_id)

                # ── Auto Error-Fix: if terminal command failed, inject repair instruction ──
                if func_name == "execute_terminal_command" and isinstance(tool_output, dict):
                    exit_code = tool_output.get("exit_code", 0)
                    if exit_code != 0:
                        session.consecutive_errors += 1
                        logger.info(
                            f"Terminal command failed (exit {exit_code}). "
                            f"Auto-fix attempt {session.consecutive_errors}/3."
                        )
                        if session.consecutive_errors <= 3:
                            # Append a strong auto-fix directive into history so
                            # the agent reads the error and immediately fixes it
                            session.history.append({
                                "role": "user",
                                "content": (
                                    f"The last terminal command failed with exit code {exit_code}. "
                                    "Read the stderr output above carefully. "
                                    "Do NOT re-scaffold or re-install from scratch. "
                                    "Identify the exact file causing the error, use read_file to inspect it, "
                                    "then use edit_file_diff to fix only the broken lines. "
                                    "Then retry the failing command to verify the fix."
                                )
                            })
                            self.save_session_to_disk(session_id)
                            yield {"type": "status", "message": f"[Auto-fix] Error detected. Attempting fix ({session.consecutive_errors}/3)..."}
                        else:
                            yield {"type": "status", "message": "[Auto-fix] Max retries reached. Stopping — review the error above."}
                            session.status = "idle"
                            session.consecutive_errors = 0
                            self.save_session_to_disk(session_id)
                            return
                    else:
                        # Command succeeded — reset error counter
                        session.consecutive_errors = 0

                yield {"type": "tool_result", "tool": func_name, "result": tool_output}

        yield {"type": "status", "message": "Max execution iterations reached."}
        session.status = "idle"
        self.save_session_to_disk(session_id)

    async def resolve_pending_diff(
        self, 
        session_id: str, 
        approved: bool, 
        feedback: Optional[str] = None,
        custom_replace_block: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        session = self.get_or_create_session(session_id)
        if not session.pending_tool_call:
            yield {"type": "error", "message": "No pending tool call found to resolve."}
            return

        tool_call = session.pending_tool_call
        tool_call_id = tool_call["id"]
        args = tool_call["args"]
        
        session.pending_tool_call = None
        session.status = "executing"
        self.save_session_to_disk(session_id)

        if approved:
            replace_block = custom_replace_block if custom_replace_block is not None else args["replace_block"]
            
            path = args["path"]
            if session.project_dir and not path.startswith(session.project_dir):
                path = os.path.join(session.project_dir, path).replace("\\", "/")

            result = self.tools.edit_file_diff(
                path=path,
                search_block=args["search_block"],
                replace_block=replace_block
            )
            session.history.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": "edit_file_diff",
                "content": result
            })
            self.save_session_to_disk(session_id)
            yield {"type": "tool_result", "tool": "edit_file_diff", "result": result}
        else:
            rejection_message = f"User rejected this edit. Feedback: {feedback or 'No comment provided.'}"
            session.history.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": "edit_file_diff",
                "content": json.dumps({"status": "failed", "error": rejection_message})
            })
            self.save_session_to_disk(session_id)
            yield {"type": "status", "message": "Edit rejected. Feeding comments back to agent..."}

        # Resume the execution loop
        async for step in self.execute_coding_step(session_id, provider=provider, model=model):
            yield step

    async def _execute_tool(self, name: str, args: Dict[str, Any], session_id: Optional[str] = None) -> Any:
        session = self.get_or_create_session(session_id) if session_id else None
        project_dir = session.project_dir if session else None

        if name == "get_repo_map":
            return self.tools.get_repo_map(args.get("exclude_dirs"), sub_dir=project_dir)
        elif name == "read_file":
            path = args["path"]
            if project_dir and not path.startswith(project_dir):
                path = os.path.join(project_dir, path).replace("\\", "/")
            return self.tools.read_file(path)
        elif name == "write_file":
            path = args["path"]
            if project_dir and not path.startswith(project_dir):
                path = os.path.join(project_dir, path).replace("\\", "/")
            return self.tools.write_file(path, args["content"])
        elif name == "execute_terminal_command":
            cwd = args.get("cwd_relative", "")
            if project_dir and not cwd.startswith(project_dir):
                cwd = os.path.join(project_dir, cwd).replace("\\", "/").strip("/")
            return await self.tools.execute_terminal_command(
                command=args["command"],
                cwd_relative=cwd,
                is_background=args.get("is_background", False)
            )
        else:
            return f"Error: Tool '{name}' not found."

    def _truncate_tool_output(self, name: str, output: Any) -> str:
        output_str = json.dumps(output) if isinstance(output, dict) else str(output)
        
        if name == "execute_terminal_command" and isinstance(output, dict):
            stdout = output.get("stdout", "")
            stderr = output.get("stderr", "")
            exit_code = output.get("exit_code", 0)
            
            if exit_code == 0:
                lines = stdout.strip().splitlines()
                summary = "\n".join(lines[-5:]) if len(lines) > 5 else stdout
                return json.dumps({
                    "exit_code": 0,
                    "stdout": f"[Truncated Success Output]\n... \n{summary}",
                    "stderr": stderr
                })
            else:
                lines = stderr.strip().splitlines()
                summary_err = "\n".join(lines[-25:]) if len(lines) > 25 else stderr
                return json.dumps({
                    "exit_code": exit_code,
                    "stdout": "[Truncated]",
                    "stderr": f"[Truncated Error Output]\n... \n{summary_err}"
                })
                
        if len(output_str) > 8000:
            return output_str[:8000] + "\n... [Remaining content truncated to save memory]"
            
        return output_str

    async def _compress_history_if_needed(self, session: AgentSession, provider: str, model: str):
        if len(session.history) <= 12:
            return

        logger.info(f"Session {session.session_id} message history count: {len(session.history)}. Initiating context compression...")
        
        messages_to_compress = session.history[:-4]
        active_messages = session.history[-4:]
        
        compression_prompt = (
            "You are a system manager. Summarize the coding actions and changes taken by the agent "
            "so far in the conversation history below into a single, highly dense summary message. "
            "State what was created, edited, and what commands succeeded. Do not include raw source codes.\n\n"
            f"History to Summarize:\n{json.dumps(messages_to_compress)}"
        )
        
        try:
            response = await self.llm.chat_completion(
                messages=[{"role": "user", "content": compression_prompt}],
                preferred_provider=provider,
                preferred_model=model
            )
            summary_content = response["choices"][0]["message"]["content"]
            
            session.history = [
                {"role": "assistant", "content": f"[System Summary of Past Work]: {summary_content}"}
            ] + active_messages
            
            self.save_session_to_disk(session.session_id)
            logger.info("Context memory compressed successfully.")
        except Exception as e:
            logger.error(f"Failed to compress session history context: {e}")

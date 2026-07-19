# Lovable Clone — Agentic AI Coding Agent

A state-of-the-art, portable AI coding assistant platform designed to mimic systems like Lovable, bolt.new, and Cursor. This project contains a high-performance Python FastAPI backend (exposing a custom agentic code-generation loop) and a responsive, highly polished React web dashboard featuring a live preview window, a step-by-step diff reviewer, and an integrated terminal.

---

## 🏗️ Core System Architecture

The project is structured into three primary modules:

1.  **Agent Backend Server (`/agent_server/`)**:
    *   **`main.py`**: A FastAPI web server exposing REST endpoints and Server-Sent Events (SSE) to stream thought sequences, file trees, and execution statuses in real time.
    *   **`orchestrator.py`**: The core execution engine. Implements a custom, asynchronous tool-calling agent loop (**[No-Langgraph]**). It manages intent routing, the planning checklist phase, execution coding iterations (max 15), context memory compression, and interactive step-by-step diff reviews.
    *   **`llm_client.py`**: A unified HTTP chat completion client with a built-in priority queue, provider cooldowns, and automatic failovers. Handles token context sanitization across multiple providers.
    *   **`sandbox.py`**: Handles sandboxed task execution, starting development processes, process tree cleaning (using Windows taskkill), and port conflict resolution.
    *   **`diff_engine.py`**: The surgical patch engine. Parses and executes search-and-replace blocks using exact-match and normalized fuzzy string alignment (matching code even if indentation or spacing differs).
    *   **`tools.py`**: Maps Python filesystem methods (read, write, list files, run commands) into JSON schemas readable by LLMs.

2.  **Frontend UI Client (`/web_ui/`)**:
    *   A responsive developer dashboard built with React (Vite) and styled with clean Vanilla CSS variables.
    *   Features a **Chat & Session Sidebar** (left), a **File Browser & Code Viewer** (center), a **Live Preview Panel** with port mapping, and a **Dev Terminal log stream** (right).
    *   **Interactive Code Reviewer (Diff Modal)**: Renders code edits side-by-side with a **live editable textarea**, allowing the user to tweak the proposed code directly and click *"Approve with My Edits"* or *"Reject with comments"*.

3.  **Workspace Sandbox (`/sandbox/`)**:
    *   An isolated directory structure where the agent scaffolds client applications. Each project is virtualized inside its own subfolder (e.g., `sandbox/notion-left-sidebar/`) to keep folders isolated.

---

## 🌟 Premium Engineering Decisions

### 1. Robust Model Failover & Cooldown Queue
To handle rate-limiting (`429`) and quota exhaustion (`402`) in free API keys, `LLMClient` implements a circuit-breaker queue. If a request to a provider fails:
*   It parses the exact `retryDelay` or cooldown period from the error payload.
*   It locks that slot with a precise TTL (saved to `.sessions/cooldowns.json`).
*   It immediately routes the request to the next highest priority provider (e.g., Gemini -> Groq -> Together -> Mistral -> OpenAI) to prevent pipeline interruption.

### 2. Cross-Provider History Context Flattening
When rotating models mid-conversation, different providers expect different schemas. For example, Gemini expects `thought_signatures` inside tool calls, while Groq and Mistral crash if they are present. To prevent 400 Bad Request errors, `_clean_messages` in `llm_client.py`:
*   Determines the latest user prompt.
*   Flattens all conversation turns *before* the latest prompt into simple plain text logs.
*   Preserves the structured `tool_calls`/`tool` schema *only* for the active turn.
*   Dynamically injects fallback signatures when rotating into Gemini.

### 3. Dynamic Directory Virtualization
To ensure the sandbox remains clean, the agent is restricted to its active project subdirectory:
*   All tool file reads, writes, and diff edits are automatically prefixed with the active `project_dir` in the backend.
*   Terminal runs (like `npm run dev`) are automatically scoped to start inside the project subfolder.
*   This prevents files (like `package.json`) from leaking to the sandbox root and ensures dev servers start in directories where dependencies are located.

### 4. Self-Healing Auto Error-Fix Loop
If a terminal build command fails (`exit_code != 0`), the orchestrator captures the stderr log, reads the failing file, and injects a repair directive into the LLM history:
*   *"The last command failed. Identify the exact file causing the error, inspect it, and apply a surgical edit using edit_file_diff to fix only the broken lines, then retry."*
*   The agent has up to **3 auto-retry attempts** to heal itself, ensuring the preview server compiles successfully before prompting the user.

### 5. Memory Efficiency & Summarization
*   **Log Truncation**: When running verbose terminal runs, only the summary or the last 20 lines of errors are appended to history, protecting token boundaries.
*   **Context Compression**: When history exceeds 12 messages, the orchestrator triggers an LLM summarization call to compress early history into a single dense summary message, reclaiming up to **80% of token context**.

---

## 🚀 Getting Started

### 1. Setup Environment
1. Clone the repository:
   ```bash
   git clone https://github.com/sharu-kesh/Lovable-Clone-AI-coding-agent.git
   cd Lovable-Clone-AI-coding-agent
   ```
2. Copy the backend environment template:
   ```bash
   cp agent_server/.env.example agent_server/.env
   ```
3. Open `agent_server/.env` and insert your API keys (e.g. `GEMINI_API_KEY`, `GROQ_API_KEY`). Set `LLM_PROVIDER` to your preferred primary model (default `gemini`).

### 2. Start the Backend Server
1. Navigate to the backend folder:
   ```bash
   cd agent_server
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the FastAPI server using Uvicorn:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   *(Backend running at http://localhost:8000)*

### 3. Start the Frontend Client
1. Open a new terminal window at the root of the project.
2. Navigate to the frontend client:
   ```bash
   cd web_ui
   ```
3. Install node dependencies:
   ```bash
   npm install
   ```
4. Start the Vite client dev server:
   ```bash
   npm run dev
   ```
   *(Web dashboard running at http://localhost:5173)*

---

## 📝 Running a Project inside the Sandbox
1. Open your browser and navigate to the client URL (`http://localhost:5173`).
2. Click the **`+`** icon next to sessions to create a new session, name it `notion-clone`.
3. In the Chat text area, type:
   > *"Build a Notion-style app with a left sidebar showing pages in a tree and a markdown editor on the right"*
4. The agent will analyze your request and generate a detailed **Plan Checklist** in the right tab.
5. Click **Approve Plan & Build**.
6. The agent will scaffold a Vite React project inside the sandbox subfolder, run `npm install`, and write components.
7. Approve diff changes through the **Interactive Code Reviewer**.
8. Go to the **Dev Terminal** tab, type `npm run dev`, and hit Enter. Vite will launch the development server.
9. Enter the port (e.g., `5173` or `5174`) in the **Live Preview** tab header and click **Refresh** to see your app running live!
10. Click the **Download** button in the sidebar to download the project as a clean ZIP (skips `node_modules` and `dist` folders).

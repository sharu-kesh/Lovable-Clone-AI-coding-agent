import os
import subprocess
import asyncio
import sys
import threading
from typing import Dict, Optional, Tuple, Any
import logging

logger = logging.getLogger("sandbox")

class SandboxManager:
    def __init__(self, base_dir: str):
        # Resolve base directory to its absolute path
        self.base_dir = os.path.abspath(base_dir)
        os.makedirs(self.base_dir, exist_ok=True)
        
        # Keep track of active background processes (e.g., dev servers)
        self.active_processes: Dict[str, asyncio.subprocess.Process] = {}
        
        # Terminal sessions: { terminal_id: { "process": Process, "logs": str, "is_running": bool } }
        from typing import Any
        self.terminal_sessions: Dict[str, Dict[str, Any]] = {}

    def safe_resolve(self, relative_path: str) -> str:
        """
        Secures file paths to ensure the agent cannot escape the sandbox directory.
        Raises ValueError if path traversal is attempted.
        """
        # Remove any leading slashes or driving letters to treat it as relative
        clean_rel = relative_path.lstrip("/\\")
        resolved = os.path.abspath(os.path.join(self.base_dir, clean_rel))
        
        # Check if the resolved path starts with the base sandbox directory
        if not resolved.startswith(self.base_dir):
            raise ValueError(f"Security boundary check failed: Path '{relative_path}' is outside sandbox.")
        
        return resolved

    async def execute_command(
        self, 
        command: str, 
        cwd_relative: str = "", 
        is_background: bool = False
    ) -> Tuple[int, str, str]:
        """
        Executes a terminal command inside the sandbox.
        Uses subprocess.Popen and threads to be fully compatible with Windows SelectorEventLoop.
        """
        cwd = self.safe_resolve(cwd_relative)
        # Ensure working directory exists before running process to prevent OS errors
        os.makedirs(cwd, exist_ok=True)
        logger.info(f"Running command: '{command}' in '{cwd}' (background={is_background})")

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["NODE_ENV"] = "development"

        if is_background:
            try:
                process = subprocess.Popen(
                    command,
                    shell=True,
                    cwd=cwd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=True,
                    encoding="utf-8",
                    errors="replace"
                )
                proc_key = f"bg_{len(self.active_processes) + 1}"
                self.active_processes[proc_key] = process
                
                # Start background thread to drain output pipes so process doesn't hang
                def drain_stream(stream):
                    try:
                        for _ in stream:
                            pass
                    except:
                        pass
                    finally:
                        stream.close()
                        
                threading.Thread(target=drain_stream, args=(process.stdout,), daemon=True).start()
                threading.Thread(target=drain_stream, args=(process.stderr,), daemon=True).start()
                
                return 0, f"Background process started with ID: {proc_key}", ""
            except Exception as e:
                return -1, "", f"Failed running background command: {str(e)}"
        else:
            # Blocking command: run and capture stdout/stderr synchronously in a thread (to avoid blocking async loop)
            def run_sync() -> Tuple[int, str, str]:
                try:
                    process = subprocess.Popen(
                        command,
                        shell=True,
                        cwd=cwd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        env=env,
                        text=True,
                        encoding="utf-8",
                        errors="replace"
                    )
                    stdout, stderr = process.communicate(timeout=180)
                    return process.returncode or 0, stdout or "", stderr or ""
                except subprocess.TimeoutExpired:
                    try:
                        # Terminate the process tree on Windows or Unix
                        if sys.platform == "win32":
                            subprocess.run(
                                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL
                            )
                        else:
                            process.kill()
                    except:
                        pass
                    stdout, stderr = process.communicate()
                    return -1, stdout or "", (stderr or "") + "\n❌ Process killed: Command exceeded the 180-second execution limit."
                except Exception as ex:
                    return -1, "", str(ex)
                    
            # Wrap blocking thread call in asyncio.to_thread
            return await asyncio.to_thread(run_sync)

    async def _drain_output(self, proc_key: str, process: asyncio.subprocess.Process):
        """
        Continuously reads process outputs so standard pipes don't overflow and hang.
        """
        try:
            while process.returncode is None:
                if process.stdout:
                    line = await process.stdout.readline()
                    if not line:
                        break
                    # Optionally forward this to terminal logs stream
                    logger.debug(f"[{proc_key}] {line.decode(errors='replace').rstrip()}")
                await asyncio.sleep(0.01)
        except Exception as e:
            logger.error(f"Error draining logs for {proc_key}: {e}")

    async def terminate_background_processes(self):
        """
        Kills all active background dev servers/commands.
        """
        for key, process in list(self.active_processes.items()):
            logger.info(f"Terminating background process: {key}")
            try:
                if sys.platform == "win32":
                    # On Windows, process.kill() sometimes misses child processes.
                    # We terminate the process tree using taskkill.
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                else:
                    process.kill()
                await process.wait()
            except Exception as e:
                logger.error(f"Failed to kill process {key}: {e}")
            del self.active_processes[key]

    async def clean_port(self, port: int = 5173):
        """
        Identifies and terminates any process currently occupying the dev server port.
        """
        logger.info(f"Checking for processes holding port {port}...")
        try:
            if sys.platform == "win32":
                def _kill_port_win():
                    result = subprocess.run(
                        f"netstat -ano | findstr :{port}",
                        shell=True, capture_output=True, text=True,
                        encoding="utf-8", errors="replace"
                    )
                    stdout = result.stdout
                    pids_to_kill = set()
                    for line in stdout.splitlines():
                        if "LISTENING" in line or f"0.0.0.0:{port}" in line or f"127.0.0.1:{port}" in line or f"[::]:{port}" in line:
                            parts = line.strip().split()
                            if len(parts) >= 5:
                                pids_to_kill.add(parts[-1])
                    if not pids_to_kill:
                        logger.info(f"Port {port} is already free: nothing to kill.")
                        return
                    for pid in pids_to_kill:
                        logger.info(f"Port {port} is occupied by PID {pid}. Killing it...")
                        subprocess.run(
                            ["taskkill", "/F", "/T", "/PID", pid],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                        )
                await asyncio.to_thread(_kill_port_win)
            else:
                # Unix system: use lsof or fuser
                def _kill_port_unix():
                    result = subprocess.run(
                        f"lsof -t -i:{port}",
                        shell=True, capture_output=True, text=True
                    )
                    stdout = result.stdout.strip()
                    if stdout:
                        for pid in stdout.split():
                            logger.info(f"Port {port} is occupied by PID {pid}. Killing it...")
                            subprocess.run(["kill", "-9", pid])
                    else:
                        logger.info(f"Port {port} is already free: nothing to kill.")
                await asyncio.to_thread(_kill_port_unix)
        except Exception as e:
            logger.error(f"Error cleaning port {port}: {e}")

    async def create_terminal(self, terminal_id: str) -> None:
        """
        Creates a new terminal session.
        """
        if terminal_id not in self.terminal_sessions:
            self.terminal_sessions[terminal_id] = {
                "process": None,
                "logs": "Terminal initialized.\n",
                "is_running": False
            }

    async def get_terminal_logs(self, terminal_id: str) -> Tuple[str, bool]:
        """
        Retrieves logs and running status of a terminal.
        """
        if terminal_id not in self.terminal_sessions:
            await self.create_terminal(terminal_id)
        session = self.terminal_sessions[terminal_id]
        return session["logs"], session["is_running"]

    async def kill_terminal(self, terminal_id: str) -> None:
        """
        Kills any process running in the terminal and marks it as stopped.
        """
        if terminal_id in self.terminal_sessions:
            session = self.terminal_sessions[terminal_id]
            process = session["process"]
            if process and session["is_running"]:
                logger.info(f"Killing terminal process: {terminal_id}")
                try:
                    if sys.platform == "win32":
                        subprocess.run(
                            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL
                        )
                    else:
                        try:
                            process.terminate()
                            for _ in range(10):
                                if process.poll() is not None:
                                    break
                                await asyncio.sleep(0.05)
                            if process.poll() is None:
                                process.kill()
                        except:
                            pass
                except Exception as e:
                    logger.error(f"Error killing terminal process {terminal_id}: {e}")
                session["logs"] += "\n[Process Terminated]\n"
            session["process"] = None
            session["is_running"] = False

    async def delete_terminal(self, terminal_id: str) -> None:
        """
        Kills process and deletes the session completely.
        """
        await self.kill_terminal(terminal_id)
        if terminal_id in self.terminal_sessions:
            del self.terminal_sessions[terminal_id]

    async def run_command_in_terminal(self, terminal_id: str, command: str, project_dir: Optional[str] = None) -> None:
        """
        Runs a shell command inside a specific terminal session using thread-based streaming.
        Compatible with all OS platforms and Python loop architectures.
        """
        if terminal_id not in self.terminal_sessions:
            await self.create_terminal(terminal_id)
            
        session = self.terminal_sessions[terminal_id]
        
        # If already running, kill the old process first
        if session["is_running"]:
            await self.kill_terminal(terminal_id)
            
        session["logs"] += f"\n$ {command}\n"
        session["is_running"] = True
        
        # Resolve working directory (sandbox project subfolder if specified)
        cwd = self.safe_resolve(project_dir or "")
        env = os.environ.copy()
        
        # Force unbuffered stdout/stderr streams
        env["PYTHONUNBUFFERED"] = "1"
        env["NODE_ENV"] = "development"
        
        try:
            # We run using Popen shell execution so it works on any platform (cmd/powershell on Win, sh/bash on Unix)
            process = subprocess.Popen(
                command,
                shell=True,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                bufsize=1,  # Line buffering
                text=True,  # String text mode
                encoding="utf-8",
                errors="replace"
            )
            session["process"] = process
            
            # Start background readers in dedicated threads (avoids asyncio loop constraints)
            t_out = threading.Thread(
                target=self._read_pipe_to_logs, 
                args=(terminal_id, process.stdout, "stdout"), 
                daemon=True
            )
            t_err = threading.Thread(
                target=self._read_pipe_to_logs, 
                args=(terminal_id, process.stderr, "stderr"), 
                daemon=True
            )
            t_out.start()
            t_err.start()
            
            # Start async check task to poll process completion status
            asyncio.create_task(self._monitor_terminal_process(terminal_id, process, t_out, t_err))
        except Exception as e:
            session["logs"] += f"Error starting command: {str(e) or type(e).__name__}\n"
            session["is_running"] = False

    def _read_pipe_to_logs(self, terminal_id: str, pipe: Any, name: str):
        """
        Reads lines from process stdout/stderr pipe inside a background thread.
        """
        session = self.terminal_sessions.get(terminal_id)
        if not session or not pipe:
            return
            
        try:
            for line in pipe:
                session["logs"] += line
        except Exception as e:
            logger.error(f"Error reading {name} for terminal {terminal_id}: {e}")
        finally:
            try:
                pipe.close()
            except:
                pass

    async def _monitor_terminal_process(self, terminal_id: str, process: subprocess.Popen, t_out: threading.Thread, t_err: threading.Thread):
        """
        Async task to check periodically if the process has completed.
        """
        session = self.terminal_sessions.get(terminal_id)
        if not session:
            return
            
        try:
            while process.poll() is None:
                await asyncio.sleep(0.15)
                
            t_out.join(timeout=0.5)
            t_err.join(timeout=0.5)
        except Exception as e:
            logger.error(f"Error monitoring terminal process {terminal_id}: {e}")
        finally:
            session["is_running"] = False

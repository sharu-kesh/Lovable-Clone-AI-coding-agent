import os
from typing import Dict, List, Any, Optional
from sandbox import SandboxManager
from diff_engine import DiffEngine, DiffApplicationError
import logging

logger = logging.getLogger("tools")

class AgentTools:
    def __init__(self, sandbox: SandboxManager):
        self.sandbox = sandbox

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        """
        Returns tool definitions formatted for LLM function calling (OpenAI/Gemini schema).
        """
        return [
            {
                "name": "get_repo_map",
                "description": "Returns a nested list of files and folders inside the sandbox workspace to understand its current structure.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "exclude_dirs": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Directory names to ignore (e.g. node_modules, dist, .git)."
                        }
                    }
                }
            },
            {
                "name": "read_file",
                "description": "Reads the entire content of a file from the sandbox workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative file path within the sandbox."
                        }
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "write_file",
                "description": "Creates a new file in the sandbox workspace with specified contents.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative file path within the sandbox."
                        },
                        "content": {
                            "type": "string",
                            "description": "The full initial text content for the file."
                        }
                    },
                    "required": ["path", "content"]
                }
            },
            {
                "name": "edit_file_diff",
                "description": "Edits an existing file using a search-and-replace block. Prefer this over full file rewrites to save tokens and time.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative file path within the sandbox."
                        },
                        "search_block": {
                            "type": "string",
                            "description": "The exact lines of code that need to be replaced."
                        },
                        "replace_block": {
                            "type": "string",
                            "description": "The new lines of code to substitute the search_block with."
                        }
                    },
                    "required": ["path", "search_block", "replace_block"]
                }
            },
            {
                "name": "execute_terminal_command",
                "description": "Executes a terminal/bash command in the sandbox base directory.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "The shell command to run (e.g. 'npm install lucide-react', 'npm run build')."
                        },
                        "cwd_relative": {
                            "type": "string",
                            "description": "Optional subdirectory within the sandbox to execute the command."
                        },
                        "is_background": {
                            "type": "boolean",
                            "description": "Set to true for long-running processes like dev servers ('npm run dev') so they do not block execution."
                        }
                    },
                    "required": ["command"]
                }
            }
        ]

    # --- Tool Implementations ---

    def get_repo_map(self, exclude_dirs: Optional[List[str]] = None, sub_dir: Optional[str] = None) -> Dict[str, Any]:
        """
        Traverses the sandbox directory and returns a structured dictionary of files.
        """
        if exclude_dirs is None:
            exclude_dirs = ["node_modules", "dist", ".git", ".next", "build", "__pycache__"]

        root_path = os.path.join(self.sandbox.base_dir, sub_dir) if sub_dir else self.sandbox.base_dir
        repo_structure = {}

        for root, dirs, files in os.walk(root_path):
            # Modify dirs in-place to skip excluded directories in walk traversal
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            # Get path relative to the root path
            rel_dir = os.path.relpath(root, root_path)
            if rel_dir == ".":
                current_node = repo_structure
            else:
                parts = rel_dir.split(os.sep)
                node = repo_structure
                for part in parts:
                    node = node.setdefault(part, {})
                current_node = node

            for file in files:
                current_node[file] = "file"

        return {"repo_map": repo_structure}

    def read_file(self, path: str) -> str:
        """
        Safely reads a file from the sandbox.
        """
        try:
            full_path = self.sandbox.safe_resolve(path)
            if not os.path.exists(full_path):
                return f"Error: File '{path}' does not exist."
            with open(full_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            return f"Error reading file: {str(e)}"

    def write_file(self, path: str, content: str) -> str:
        """
        Safely creates a new file.
        """
        try:
            full_path = self.sandbox.safe_resolve(path)
            # Ensure directories exist
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Success: File created at '{path}'."
        except Exception as e:
            return f"Error writing file: {str(e)}"

    def edit_file_diff(self, path: str, search_block: str, replace_block: str) -> str:
        """
        Safely modifies an existing file using the DiffEngine search-and-replace block.
        """
        try:
            full_path = self.sandbox.safe_resolve(path)
            if not os.path.exists(full_path):
                return f"Error: File '{path}' does not exist. Use write_file to create new files."
            
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read()

            # Apply diff
            new_content = DiffEngine.apply_patch(content, search_block, replace_block)
            
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(new_content)
                
            return f"Success: Modified '{path}' using patch."
        except DiffApplicationError as de:
            return f"Diff Application Failed: {str(de)}"
        except Exception as e:
            return f"Error editing file: {str(e)}"

    async def execute_terminal_command(self, command: str, cwd_relative: str = "", is_background: bool = False) -> Dict[str, Any]:
        """
        Executes terminal commands inside sandbox using SandboxManager.
        """
        try:
            exit_code, stdout, stderr = await self.sandbox.execute_command(
                command, cwd_relative, is_background
            )
            return {
                "exit_code": exit_code,
                "stdout": stdout,
                "stderr": stderr
            }
        except Exception as e:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Error running command: {str(e)}"
            }

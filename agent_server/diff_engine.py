import re
import difflib
from typing import List, Tuple

class DiffApplicationError(Exception):
    """Custom exception raised when a diff cannot be applied to a file."""
    pass

class DiffEngine:
    @staticmethod
    def parse_patches(patch_text: str) -> List[Tuple[str, str]]:
        """
        Parses a text response from the LLM containing one or more SEARCH/REPLACE blocks.
        
        Returns:
            A list of tuples: [(search_content, replace_content), ...]
        """
        # Regex to capture content between <<<<<<< SEARCH, =======, and >>>>>>> REPLACE
        pattern = re.compile(
            r"<<<<<<<\s*SEARCH\n(.*?)\n=======\n(.*?)\n>>>>>>>\s*REPLACE", 
            re.DOTALL
        )
        
        matches = pattern.findall(patch_text)
        return [(search.strip('\r'), replace.strip('\r')) for search, replace in matches]

    @staticmethod
    def _normalize_string(text: str) -> str:
        """
        Helper method to normalize spacing, indentation, and newlines.
        Used for fuzzy matching when code format slightly shifts.
        """
        # Compress multiple spaces/tabs into a single space and remove carriage returns
        normalized = re.sub(r'[ \t]+', ' ', text.replace('\r', ''))
        # Split into lines, strip trailing spaces, and join back
        lines = [line.rstrip() for line in normalized.split('\n')]
        return '\n'.join(lines).strip()

    @classmethod
    def apply_patch(cls, file_content: str, search_block: str, replace_block: str) -> str:
        """
        Applies a single search-and-replace block to the file content.
        Handles both exact matches and fuzzy matches.
        """
        # Case 1: Exact Match (Fastest & Safest)
        if search_block in file_content:
            # If the search block is empty
            if not search_block:
                raise DiffApplicationError("Empty SEARCH block matches everything. Please provide context lines.")
            
            # Count occurrences to prevent modifying wrong blocks if duplicate exists
            occurrences = file_content.count(search_block)
            if occurrences > 1:
                raise DiffApplicationError(
                    f"Found {occurrences} exact matches for the SEARCH block. "
                    "Please include more surrounding context lines to make it unique."
                )
            
            return file_content.replace(search_block, replace_block, 1)

        # Case 2: Fuzzy Matching (Resolves spacing/indentation edge cases)
        normalized_content = cls._normalize_string(file_content)
        normalized_search = cls._normalize_string(search_block)

        if normalized_search not in normalized_content:
            # Show diff comparison to help debug in LLM context
            diff = list(difflib.ndiff(
                search_block.splitlines(),
                file_content.splitlines()
            ))
            snippet = "\n".join(diff[:15]) # Limit size of debug output
            raise DiffApplicationError(
                "Could not find the SEARCH block in the file. "
                f"Close matches / File preview:\n{snippet}"
            )

        # Count occurrences in normalized text
        occurrences = normalized_content.count(normalized_search)
        if occurrences > 1:
            raise DiffApplicationError(
                f"Found {occurrences} fuzzy matches for the SEARCH block. "
                "Please add more surrounding lines to make it unique."
            )

        # Locate the normalized search block within the normalized content
        file_lines = file_content.splitlines(keepends=True)
        search_lines = search_block.splitlines()

        # Find the line indices where the match begins using a sliding window
        match_start_idx = -1
        
        # Check slices of lines matching the count of search lines
        for i in range(len(file_lines) - len(search_lines) + 1):
            window = file_lines[i : i + len(search_lines)]
            window_str = "".join(window)
            
            # Compare normalized representations of this window vs target search block
            norm_window = cls._normalize_string(window_str)
            if norm_window == normalized_search:
                match_start_idx = i
                break
        
        if match_start_idx == -1:
            raise DiffApplicationError(
                "Fuzzy match was detected in text, but could not align line structures."
            )

        # Replace the window of lines with the replacement block
        # Detect the indentation of the first line in the matched window
        first_matched_line = file_lines[match_start_idx]
        indentation = re.match(r"^([ \t]*)", first_matched_line).group(1)

        # Re-indent the replacement lines to match the context
        replace_lines = replace_block.splitlines(keepends=True)
        reindented_replace = []
        for line in replace_lines:
            if line.strip():
                reindented_replace.append(indentation + line.lstrip())
            else:
                reindented_replace.append(line)

        # Assemble new lines
        result_lines = (
            file_lines[:match_start_idx] +
            reindented_replace +
            file_lines[match_start_idx + len(search_lines):]
        )
        return "".join(result_lines)

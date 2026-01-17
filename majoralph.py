#!/usr/bin/env python3
"""ralph loop wrapper

spawns a fresh agent process per iteration and persists long-term memory via repo files
(prd.json, progress.txt, AGENTS.md) and git commits.

notes:
- deliberately runner-agnostic.
- deliberately boring. boring is good.

usage:
    ```py
    python majoralph.py --init
    python majoralph.py --runner opencode --opencode-attach http://127.0.0.1:4096 --max-iters 30
    ```
"""

from __future__ import annotations

import ctypes
import json
import re
from argparse import ArgumentParser
from datetime import datetime
from pathlib import Path
from shutil import copy2, copytree, which
from subprocess import PIPE, STDOUT, Popen
from sys import exit, platform, stderr
from time import monotonic, sleep
from typing import Any, Final, NamedTuple

# type alias for prd/json dicts (untyped json data)
JsonDict = dict[str, Any]

DEFAULTSENTINEL: Final[str] = r"<promise>\s*COMPLETE\s*</promise>"
STATEFOLDERNAME: Final[str] = ".ralph"
ITERPROMPTFILENAME: Final[str] = "iteration_prompt.md"
AGENTS_FILENAME: Final[str] = "AGENTS.md"
TUI_DISPLAY_LINES: Final[int] = 6

PRDTEMPLATE: Final[JsonDict] = {
    "project": "MyProject",
    "branchName": "ralph/my-feature",
    "description": "Describe the feature here",
    "userStories": [
        {
            "id": "US-001",
            "title": "First small story",
            "description": "As a user, ...",
            "acceptanceCriteria": ["Typecheck passes", "Tests pass (if present)"],
            "priority": 1,
            "passes": False,
            "notes": "",
        }
    ],
}

PROMPTTEMPLATE: Final[str] = """# prompt.md

You are an autonomous coding agent operating in a Ralph loop.

Rules:
- Each iteration is a fresh run (no chat history).
- Persist memory ONLY via repo files (prd.json, progress.txt, AGENTS.md) and git commits.
- Pick ONE unfinished story (passes=false), implement it, run checks/tests, commit, update prd.json + progress.txt.
- Only set passes=true when acceptanceCriteria are met.
- After each iteration, write durable learnings (patterns/gotchas/conventions) into the nearest relevant AGENTS.md.
- When ALL stories are passes=true, print EXACTLY: <promise>COMPLETE</promise>
"""

HELPEPILOG: Final[str] = r"""
examples:

setup
-----
  python majoralph.py --init

inspect
-------
  python majoralph.py --check

amp
---
  python majoralph.py --runner amp --max-iters 10
  python majoralph.py --runner amp --amp-allow-all --max-iters 10

opencode
-------
  python majoralph.py --runner opencode --max-iters 20
  python majoralph.py --runner opencode --opencode-model opencode/glm-4.7-free --opencode-format json --max-iters 20

attach to an opencode server (faster repeated runs)
-----------------------------------------------
  opencode serve
  python majoralph.py --runner opencode --opencode-attach http://127.0.0.1:4096 --max-iters 30

custom runner (any cli)
-----------------------
  python majoralph.py --runner custom --custom-cmd myagent run --message {PROMPT} --max-iters 10

notes
-----
- on windows, command-line length is a thing. this wrapper writes the full prompt to:
    .ralph/iteration_prompt.md
  and passes a short bootstrap message to the agent.
- for opencode, this wrapper also attaches:
    iteration_prompt.md, prd.json, progress.txt, AGENTS.md
  via --file.
""".strip()


class Behaviour(NamedTuple):
    """
    ralph loop configuration

    attributes:
        `repo: pathlib.Path`
            repository root to operate in.
        `init: bool`
            initialise prompt.md/prd.json/progress.txt/AGENTS.md if missing, then exit.
        `check: bool`
            show prd status and warnings, then exit.
        `maxiters: int`
            maximum ralph iterations.
        `sleep: float`
            seconds to sleep between iterations.
        `timeout: int | None`
            per-iteration timeout in seconds.
        `sentinel: str`
            regex to detect completion in runner output.
        `promptfile: pathlib.Path`
            prompt.md path.
        `prdfile: pathlib.Path`
            prd.json path.
        `progressfile: pathlib.Path`
            progress.txt path.
        `runner: str`
            runner name: amp/opencode/custom.
        `runnerargs: list[str]`
            extra args appended to runner command.
        `dryrun: bool`
            print runner command, then exit.
        `ampbin: str`
            amp executable.
        `ampallowall: bool`
            pass --dangerously-allow-all to amp.
        `opencodebin: str`
            opencode executable.
        `opencodeformat: str`
            opencode --format.
        `opencodemodel: str | None`
            opencode --model.
        `opencodeagent: str | None`
            opencode --agent.
        `opencodeattach: str | None`
            opencode --attach.
        `customcmd: list[str] | None`
            custom runner command tokens.
    """

    repo: Path
    init: bool
    check: bool
    maxiters: int
    sleep: float
    timeout: int | None
    sentinel: str
    promptfile: Path
    prdfile: Path
    progressfile: Path
    runner: str
    runnerargs: list[str]
    dryrun: bool

    ampbin: str
    ampallowall: bool

    opencodebin: str
    opencodeformat: str
    opencodemodel: str | None
    opencodeagent: str | None
    opencodeattach: str | None

    customcmd: list[str] | None


# --- terminal/tui utilities ---


def enable_ansi_windows() -> None:
    """enable ANSI escape sequence processing on windows"""
    if platform != "win32":
        return

    try:
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_ulong()
        kernel32.GetConsoleMode(handle, ctypes.byref(mode))
        kernel32.SetConsoleMode(
            handle, mode.value | 0x0004
        )  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
    except Exception:
        pass


def parse_opencode_json(line: str) -> str | None:
    """
    parse an opencode json line and extract a human-readable summary

    arguments:
        `line: str`
            raw line from opencode json output.

    returns: `str | None`
        human-readable summary, or None if unparseable/unknown.
    """
    try:
        data = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None

    event_type = data.get("type", "")
    part = data.get("part", {})

    if event_type == "text":
        text = part.get("text", "").strip()
        return text[:120] if text else None

    if event_type == "tool_use":
        tool = part.get("tool", "tool")
        state = part.get("state", {})
        status = state.get("status", "")
        input_data = state.get("input", {})
        desc = input_data.get("description", "") or input_data.get("command", "")
        if desc:
            return f"\033[36m[{tool}]\033[0m {desc[:80]}"
        return f"\033[36m[{tool}]\033[0m {status}"

    if event_type == "step_start":
        return "\033[33m--- step started ---\033[0m"

    if event_type == "step_finish":
        reason = part.get("reason", "")
        tokens = part.get("tokens", {})
        input_tokens = tokens.get("input", 0)
        output_tokens = tokens.get("output", 0)
        if input_tokens or output_tokens:
            return f"\033[33m--- step finished ({reason}) [in:{input_tokens} out:{output_tokens}] ---\033[0m"
        return f"\033[33m--- step finished ({reason}) ---\033[0m"

    return None


class TuiDisplay:
    """
    pseudo-tui display using ansi escape sequences

    shows the latest N lines of output with live updates.

    attributes:
        `lines: int`
            number of display lines to show.
        `buffer: list[str]`
            circular buffer of recent lines.
        `parse_json: bool`
            whether to parse opencode json output.
        `rendered_count: int`
            how many lines were last rendered (for clearing).
    """

    lines: int
    buffer: list[str]
    parse_json: bool
    rendered_count: int

    def __init__(self, lines: int = TUI_DISPLAY_LINES, parse_json: bool = False):
        self.lines = lines
        self.buffer = []
        self.parse_json = parse_json
        self.rendered_count = 0

    def _clear_display(self) -> None:
        """clear the previously rendered display area"""
        if self.rendered_count > 0:
            # move cursor up and clear each line
            for _ in range(self.rendered_count):
                print("\033[F\033[K", end="", file=stderr)
            self.rendered_count = 0

    def _render(self) -> None:
        """render the current buffer to stderr"""
        display_lines = self.buffer[-self.lines :]
        for line in display_lines:
            # truncate long lines
            truncated = line[:100] + "..." if len(line) > 100 else line
            print(f"\033[2m{truncated}\033[0m", file=stderr)
        self.rendered_count = len(display_lines)

    def update(self, raw_line: str) -> None:
        """
        update the display with a new line

        arguments:
            `raw_line: str`
                raw output line from the subprocess.
        """
        line = raw_line.rstrip()
        if not line:
            return

        display_text = line
        if self.parse_json:
            parsed = parse_opencode_json(line)
            if parsed:
                display_text = parsed
            else:
                # for non-json or unknown json, show abbreviated raw
                display_text = line[:80] if len(line) > 80 else line

        self._clear_display()
        self.buffer.append(display_text)

        # keep buffer bounded
        if len(self.buffer) > self.lines * 2:
            self.buffer = self.buffer[-self.lines :]

        self._render()

    def clear(self) -> None:
        """clear the display and reset state"""
        self._clear_display()
        self.buffer.clear()


# --- core utilities ---


def printferr(*args: object) -> None:
    """
    print to stderr

    arguments:
        `*args: object`
            values to print.
    """
    print(*args, file=stderr)


def resolve_exe(exe: str) -> str | None:
    """
    resolve an executable in a cross-platform way

    arguments:
        `exe: str`
            executable name or path.

    returns: `str | None`
        resolved path if found, else None.
    """
    found = which(exe)
    if found:
        return found
    if Path(exe).exists():
        return exe
    return None


def detect_available_runner() -> str:
    """
    detect which runner is available

    returns: `str`
        runner name ("amp", "opencode", or "custom").
    """
    if resolve_exe("amp"):
        return "amp"
    if resolve_exe("opencode"):
        return "opencode"
    return "custom"


def ensure_git_repo(repo: Path) -> bool:
    """
    check that the directory is a git worktree

    arguments:
        `repo: pathlib.Path`
            repository root.

    returns: `bool`
        True if inside a git worktree.
    """
    cp = Popen(
        ["git", "rev-parse", "--is-inside-work-tree"],
        cwd=repo,
        stdout=PIPE,
        stderr=PIPE,
        text=True,
    )
    out, _ = cp.communicate()
    return cp.returncode == 0 and "true" in (out or "")


def load_json(path: Path, defaultobj: JsonDict) -> JsonDict:
    """
    load json from disk, creating it if missing

    arguments:
        `path: pathlib.Path`
            json file path.
        `defaultobj: dict`
            default object to write if file missing.

    returns: `dict`
        loaded json object.

    raises: `RuntimeError`
        if the json exists but is malformed.
    """
    if not path.exists():
        save_json(path, defaultobj)
        return defaultobj

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid json in {path}: {exc}") from exc


def save_json(path: Path, obj: JsonDict) -> None:
    """
    save json to disk

    arguments:
        `path: pathlib.Path`
            json file path.
        `obj: dict`
            json object.
    """
    _ = path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text(
        json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def ensure_files(
    promptfile: Path, prdfile: Path, progressfile: Path, agentsfile: Path
) -> None:
    """
    ensure durable state files exist

    arguments:
        `promptfile: pathlib.Path`
            prompt.md path.
        `prdfile: pathlib.Path`
            prd.json path.
        `progressfile: pathlib.Path`
            progress.txt path.
        `agentsfile: pathlib.Path`
            AGENTS.md path.
    """
    if not promptfile.exists():
        _ = promptfile.write_text(PROMPTTEMPLATE, encoding="utf-8")

    if not prdfile.exists():
        save_json(prdfile, PRDTEMPLATE)

    if not progressfile.exists():
        _ = progressfile.write_text(
            f"# Ralph Progress Log\nStarted: {datetime.now().isoformat(timespec='seconds')}\n---\n",
            encoding="utf-8",
        )

    if not agentsfile.exists():
        _ = agentsfile.write_text(
            (
                "# AGENTS.md\n\n"
                "Durable learnings for coding agents and humans.\n\n"
                "Add conventions, gotchas, and patterns discovered during Ralph iterations.\n"
            ),
            encoding="utf-8",
        )


# --- prd utilities ---


def prd_stories(prd: JsonDict) -> list[JsonDict]:
    """
    get the stories list from a prd dict

    supports both `userStories` and `stories` keys.

    arguments:
        `prd: dict`
            prd data.

    returns: `list[dict]`
        list of story dicts.
    """
    if isinstance(prd.get("userStories"), list):
        return prd["userStories"]
    if isinstance(prd.get("stories"), list):
        return prd["stories"]
    return []


def prd_progress(prd: JsonDict) -> tuple[int, int]:
    """
    count completed stories

    arguments:
        `prd: dict`
            prd data.

    returns: `tuple[int, int]`
        (done, total).
    """
    stories = prd_stories(prd)
    return sum(1 for s in stories if s.get("passes")), len(stories)


def prd_done(prd: JsonDict) -> bool:
    """
    check if all stories are `passes=true`

    arguments:
        `prd: dict`
            prd data.

    returns: `bool`
        True if at least one story exists and all are passes.
    """
    stories = prd_stories(prd)
    return bool(stories) and all(bool(s.get("passes")) for s in stories)


def prd_branch(prd: JsonDict) -> str:
    """
    read target git branch from prd

    arguments:
        `prd: dict`
            prd data.

    returns: `str`
        branch name, or empty string.
    """
    branch_name = prd.get("branchName") or prd.get("branch") or ""
    return str(branch_name).strip()


def safe_folder_name(name: str) -> str:
    """
    make a string safe for folder names

    arguments:
        `name: str`
            input name.

    returns: `str`
        sanitized name.
    """
    out = name
    for ch in ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]:
        out = out.replace(ch, "_")
    if name.startswith("ralph/"):
        out = safe_folder_name(name[len("ralph/") :])
    return out or "unknown"


# --- git/state utilities ---


def maybe_archive(
    state: Path, prdfile: Path, progressfile: Path, lastbranchfile: Path
) -> None:
    """
    archive previous ralph state when branch changes

    arguments:
        `state: pathlib.Path`
            .ralph directory.
        `prdfile: pathlib.Path`
            prd.json path.
        `progressfile: pathlib.Path`
            progress.txt path.
        `lastbranchfile: pathlib.Path`
            file storing last seen branch.
    """
    if not prdfile.exists() or not lastbranchfile.exists():
        return

    prd = load_json(prdfile, PRDTEMPLATE)
    current = prd_branch(prd)
    last = lastbranchfile.read_text(encoding="utf-8", errors="replace").strip()

    if not current or not last or current == last:
        return

    archives = state.joinpath("archive")
    logs = state.joinpath("logs")

    date = datetime.now().strftime("%Y-%m-%d")
    dest = archives.joinpath(f"{date}-{safe_folder_name(last)}")
    dest.mkdir(parents=True, exist_ok=True)

    try:
        _ = copy2(prdfile, dest.joinpath(prdfile.name))
        if progressfile.exists():
            _ = copy2(progressfile, dest.joinpath(progressfile.name))
        if logs.exists():
            _ = copytree(logs, dest.joinpath("logs"), dirs_exist_ok=True)

        _ = progressfile.write_text(
            f"# Ralph Progress Log\nStarted: {datetime.now().isoformat(timespec='seconds')}\n---\n",
            encoding="utf-8",
        )
        printferr(f"info: archived previous ralph state to {dest}")

    except Exception as exc:
        printferr(f"warn: failed to archive old state: {exc.__class__.__name__} {exc}")


def ensure_on_branch(repo: Path, branch: str) -> None:
    """
    checkout (or create) the target branch

    arguments:
        `repo: pathlib.Path`
            repo root.
        `branch: str`
            branch name.
    """
    if not branch:
        return

    cp = Popen(
        ["git", "branch", "--show-current"],
        cwd=repo,
        stdout=PIPE,
        stderr=PIPE,
        text=True,
    )
    current, _ = cp.communicate()
    current = (current or "").strip()

    if current == branch:
        return

    exists = Popen(
        ["git", "show-ref", "--verify", f"refs/heads/{branch}"],
        cwd=repo,
        stdout=PIPE,
        stderr=PIPE,
        text=True,
    )
    _ = exists.communicate()

    if exists.returncode == 0:
        _ = Popen(["git", "checkout", branch], cwd=repo).wait()
    else:
        _ = Popen(["git", "checkout", "-b", branch], cwd=repo).wait()


# --- prompt/command building ---


def build_iteration_prompt(
    promptfile: Path, prdfile: Path, progressfile: Path, sentinel: str
) -> str:
    """
    compose the full per-iteration prompt

    arguments:
        `promptfile: pathlib.Path`
            prompt.md path.
        `prdfile: pathlib.Path`
            prd.json path.
        `progressfile: pathlib.Path`
            progress.txt path.
        `sentinel: str`
            completion sentinel regex.

    returns: `str`
        prompt text to write into .ralph/iteration_prompt.md.
    """
    base = (
        promptfile.read_text(encoding="utf-8", errors="replace").strip()
        if promptfile.exists()
        else ""
    )

    wrapper = (
        "\n\n"
        "RALPH LOOP WRAPPER CONTRACT\n"
        "--------------------------\n"
        "- fresh context each iteration. no chat history.\n"
        f"- durable state: {prdfile.name}, {progressfile.name}, {AGENTS_FILENAME}, git commits.\n"
        "- pick ONE unfinished story (passes=false).\n"
        "- run checks/tests.\n"
        "- commit.\n"
        "- update prd.json + append progress.txt.\n"
        "- write durable learnings into the nearest relevant AGENTS.md (or repo-root AGENTS.md).\n"
        "- when ALL stories are passes=true, print exactly: <promise>COMPLETE</promise>\n"
        f"- wrapper sentinel regex: {sentinel}\n"
    )

    return (base + wrapper + "\n") if base else (wrapper.strip() + "\n")


def runner_command(
    behaviour: Behaviour,
    bootstrapprompt: str,
    iterpromptfile: Path | None = None,
    prdfile: Path | None = None,
    progressfile: Path | None = None,
    agentsfile: Path | None = None,
) -> list[str]:
    """
    build the runner command token list

    arguments:
        `behaviour: Behaviour`
            ralph behaviour.
        `bootstrapprompt: str`
            short message passed to the runner.
        `iterpromptfile: pathlib.Path | None`
            .ralph/iteration_prompt.md file to attach where supported.
        `prdfile: pathlib.Path | None`
            prd.json file to attach where supported.
        `progressfile: pathlib.Path | None`
            progress.txt file to attach where supported.
        `agentsfile: pathlib.Path | None`
            AGENTS.md file to attach where supported.

    returns: `list[str]`
        subprocess argv tokens.

    raises: `ValueError`
        if runner config is invalid.
    """
    if behaviour.runner == "amp":
        cmd = [behaviour.ampbin]
        if behaviour.ampallowall:
            cmd.append("--dangerously-allow-all")
        cmd += ["-x", bootstrapprompt]
        return cmd + list(behaviour.runnerargs)

    if behaviour.runner == "opencode":
        cmd = [behaviour.opencodebin, "run", "--format", behaviour.opencodeformat]

        if behaviour.opencodeattach:
            cmd += ["--attach", behaviour.opencodeattach]
        if behaviour.opencodemodel:
            cmd += ["--model", behaviour.opencodemodel]
        if behaviour.opencodeagent:
            cmd += ["--agent", behaviour.opencodeagent]

        files = [
            str(f)
            for f in [iterpromptfile, prdfile, progressfile, agentsfile]
            if f is not None
        ]
        if files:
            cmd += ["--file", *files]

        cmd += ["--", bootstrapprompt]
        return cmd + list(behaviour.runnerargs)

    if behaviour.runner == "custom":
        if not behaviour.customcmd:
            raise ValueError("custom runner requires --custom-cmd")

        cmd: list[str] = []
        used = False
        for token in behaviour.customcmd:
            if "{PROMPT}" in token:
                cmd.append(token.replace("{PROMPT}", bootstrapprompt))
                used = True
            else:
                cmd.append(token)

        if not used:
            cmd.append(bootstrapprompt)

        return cmd + list(behaviour.runnerargs)

    raise ValueError(f"unknown runner: {behaviour.runner}")


# --- argument parsing ---


def create_parser(defaultrunner: str) -> ArgumentParser:
    """
    create the argument parser

    arguments:
        `defaultrunner: str`
            default runner to use.

    returns: `argparse.ArgumentParser`
        configured parser.
    """
    parser = ArgumentParser(
        description="ralph loop wrapper (fresh process per iteration, durable state in files)",
        epilog=HELPEPILOG,
        formatter_class=lambda prog: __import__("argparse").RawDescriptionHelpFormatter(
            prog
        ),
    )

    _ = parser.add_argument(
        "--repo", type=Path, default=Path("."), help="repo root (default: .)"
    )
    _ = parser.add_argument(
        "--init", action="store_true", help="create state files if missing, then exit"
    )
    _ = parser.add_argument(
        "--check", action="store_true", help="print prd status and warnings, then exit"
    )

    _ = parser.add_argument(
        "--max-iters", type=int, default=10, help="maximum iterations (default: 10)"
    )
    _ = parser.add_argument(
        "--sleep",
        type=float,
        default=2.0,
        help="sleep seconds between iterations (default: 2.0)",
    )
    _ = parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="per-iteration timeout seconds (default: none)",
    )
    _ = parser.add_argument(
        "--sentinel",
        type=str,
        default=DEFAULTSENTINEL,
        help="completion sentinel regex",
    )

    _ = parser.add_argument(
        "--prompt-file",
        type=Path,
        default=Path("prompt.md"),
        help="prompt file (default: prompt.md)",
    )
    _ = parser.add_argument(
        "--prd",
        type=Path,
        default=Path("prd.json"),
        help="prd file (default: prd.json)",
    )
    _ = parser.add_argument(
        "--progress", type=Path, default=Path("progress.txt"), help="progress file"
    )

    _ = parser.add_argument(
        "--runner", choices=["amp", "opencode", "custom"], default=defaultrunner
    )
    _ = parser.add_argument(
        "--runner-arg",
        action="append",
        default=[],
        help="extra args appended to runner (repeatable)",
    )
    _ = parser.add_argument(
        "--dry-run", action="store_true", help="print runner command tokens, then exit"
    )

    # amp
    _ = parser.add_argument("--amp-bin", type=str, default="amp")
    _ = parser.add_argument("--amp-allow-all", action="store_true")

    # opencode
    _ = parser.add_argument("--opencode-bin", type=str, default="opencode")
    _ = parser.add_argument(
        "--opencode-format", type=str, default="default", choices=["default", "json"]
    )
    _ = parser.add_argument("--opencode-model", type=str, default=None)
    _ = parser.add_argument("--opencode-agent", type=str, default=None)
    _ = parser.add_argument("--opencode-attach", type=str, default=None)

    # custom
    _ = parser.add_argument(
        "--custom-cmd", nargs="+", default=None, help="custom runner command tokens"
    )

    return parser


def handle_args(argv: list[str] | None = None) -> Behaviour:
    """
    parse argv into a Behaviour

    arguments:
        `argv: list[str] | None`
            argument vector; if None, uses sys.argv implicitly.

    returns: `Behaviour`
        parsed behaviour.
    """
    defaultrunner = detect_available_runner()
    parser = create_parser(defaultrunner)
    args = parser.parse_args(argv)

    return Behaviour(
        repo=args.repo,
        init=bool(args.init),
        check=bool(args.check),
        maxiters=int(args.max_iters),
        sleep=float(args.sleep),
        timeout=int(args.timeout) if args.timeout is not None else None,
        sentinel=str(args.sentinel),
        promptfile=args.prompt_file,
        prdfile=args.prd,
        progressfile=args.progress,
        runner=str(args.runner),
        runnerargs=list(args.runner_arg or []),
        dryrun=bool(args.dry_run),
        ampbin=str(args.amp_bin),
        ampallowall=bool(args.amp_allow_all),
        opencodebin=str(args.opencode_bin),
        opencodeformat=str(args.opencode_format),
        opencodemodel=args.opencode_model,
        opencodeagent=args.opencode_agent,
        opencodeattach=args.opencode_attach,
        customcmd=list(args.custom_cmd) if args.custom_cmd else None,
    )


# --- subprocess execution ---


def append_text(path: Path, text: str) -> None:
    """
    append text to a file

    arguments:
        `path: pathlib.Path`
            file to append to.
        `text: str`
            text to append.
    """
    _ = path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        _ = f.write(text)


def run_tee(
    cmd: list[str],
    cwd: Path,
    logfile: Path,
    timeout: int | None,
    use_tui: bool = False,
    parse_json: bool = False,
) -> tuple[int, str]:
    """
    run a subprocess and tee combined output to console + file

    combines stdout+stderr, prints live (with optional tui), and writes log file.

    arguments:
        `cmd: list[str]`
            subprocess argv.
        `cwd: pathlib.Path`
            working directory.
        `logfile: pathlib.Path`
            file path to write combined output.
        `timeout: int | None`
            timeout in seconds, or None for no timeout.
        `use_tui: bool`
            use pseudo-tui display instead of raw output.
        `parse_json: bool`
            parse opencode json output for display.

    returns: `tuple[int, str]`
        (returncode, combined_output).
    """
    logfile.parent.mkdir(parents=True, exist_ok=True)

    start = monotonic()
    combined: list[str] = []
    tui = TuiDisplay(parse_json=parse_json) if use_tui else None

    with open(logfile, "w", encoding="utf-8") as lf:
        proc = Popen(cmd, cwd=cwd, stdout=PIPE, stderr=STDOUT, text=True, bufsize=1)
        assert proc.stdout is not None

        while True:
            if timeout is not None and (monotonic() - start) > float(timeout):
                lf.write(f"\n[wrapper] timeout after {timeout}s; terminating process\n")
                lf.flush()
                try:
                    proc.terminate()
                except Exception:
                    pass
                try:
                    _ = proc.wait(timeout=5)
                except Exception:
                    try:
                        _ = proc.kill()
                    except Exception:
                        pass
                    _ = proc.wait()
                break

            line = proc.stdout.readline()
            if line:
                lf.write(line)
                _ = lf.flush()
                combined.append(line)

                if tui:
                    tui.update(line)
                else:
                    print(line, end="")
                continue

            if proc.poll() is not None:
                break

            sleep(0.05)

        if tui:
            tui.clear()

        rc = proc.returncode if proc.returncode is not None else 1

    return rc, "".join(combined)


# --- main entrypoint ---


def entry() -> int:
    """
    cli entrypoint

    returns: `int`
        process exit code.
    """
    enable_ansi_windows()

    behaviour = handle_args()
    repo = behaviour.repo.resolve()

    if not ensure_git_repo(repo):
        printferr("error: not a git repository (run from a repo root)")
        return 2

    promptfile = repo.joinpath(behaviour.promptfile)
    prdfile = repo.joinpath(behaviour.prdfile)
    progressfile = repo.joinpath(behaviour.progressfile)
    agentsfile = repo.joinpath(AGENTS_FILENAME)

    ensure_files(promptfile, prdfile, progressfile, agentsfile)

    state = repo.joinpath(STATEFOLDERNAME)
    logs = state.joinpath("logs")
    archives = state.joinpath("archive")
    lastbranchfile = state.joinpath(".last-branch")
    iterpromptfile = state.joinpath(ITERPROMPTFILENAME)

    logs.mkdir(parents=True, exist_ok=True)
    archives.mkdir(parents=True, exist_ok=True)

    # resolve runner binary early
    if behaviour.runner == "amp":
        resolved = resolve_exe(behaviour.ampbin)
        if not resolved:
            printferr(f"error: amp executable not found: {behaviour.ampbin!r}")
            return 2
        behaviour = behaviour._replace(ampbin=resolved)

    elif behaviour.runner == "opencode":
        resolved = resolve_exe(behaviour.opencodebin)
        if not resolved:
            printferr(
                f"error: opencode executable not found: {behaviour.opencodebin!r}"
            )
            return 2
        behaviour = behaviour._replace(opencodebin=resolved)

    elif behaviour.runner == "custom":
        if not behaviour.customcmd:
            printferr("error: custom runner requires --custom-cmd")
            return 2
        resolved = resolve_exe(behaviour.customcmd[0])
        if not resolved:
            printferr(
                f"error: custom runner executable not found: {behaviour.customcmd[0]!r}"
            )
            return 2
        behaviour = behaviour._replace(customcmd=[resolved, *behaviour.customcmd[1:]])

    if behaviour.init:
        printferr(
            f"info: initialised {promptfile} {prdfile} {progressfile} {agentsfile}"
        )
        return 0

    prd = load_json(prdfile, PRDTEMPLATE)

    if behaviour.check:
        done, total = prd_progress(prd)
        printferr(f"info: prd progress {done}/{total}")
        for story in prd_stories(prd):
            status = "PASS" if story.get("passes") else "TODO"
            printferr(f"  - [{status}] {story.get('id')}: {story.get('title')}")
        return 0

    # archive on branch change
    maybe_archive(state, prdfile, progressfile, lastbranchfile)

    # ensure git branch matches prd
    branch = prd_branch(prd)
    if branch:
        ensure_on_branch(repo, branch)
        _ = lastbranchfile.write_text(branch + "\n", encoding="utf-8")

    sentinelre = re.compile(behaviour.sentinel, re.IGNORECASE)

    # determine tui settings
    use_tui = behaviour.opencodeformat == "json"
    parse_json = behaviour.opencodeformat == "json"

    # bootstrap prompt (small; actual prompt is in attached file)
    bootstrapprompt = (
        "Read and follow the attached iteration prompt. "
        "Also read the attached prd.json, progress.txt, and AGENTS.md. "
        "The iteration prompt contains the exact completion marker to print when done."
    )

    for i in range(1, behaviour.maxiters + 1):
        prd = load_json(prdfile, PRDTEMPLATE)
        done, total = prd_progress(prd)

        if prd_done(prd):
            printferr("info: all stories pass; stopping")
            return 0

        _ = iterpromptfile.write_text(
            build_iteration_prompt(
                promptfile, prdfile, progressfile, behaviour.sentinel
            ),
            encoding="utf-8",
        )

        cmd = runner_command(
            behaviour,
            bootstrapprompt,
            iterpromptfile,
            prdfile,
            progressfile,
            agentsfile,
        )

        if behaviour.dryrun:
            printferr("info: dry run command tokens:")
            for token in cmd:
                printferr(token)
            return 0

        printferr(f"info: iteration {i}/{behaviour.maxiters} [{done}/{total}]")
        append_text(
            progressfile,
            f"\n--- Iteration {i} started: {datetime.now().isoformat(timespec='seconds')} ---\n",
        )

        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        logfile = logs.joinpath(f"iter-{i:04d}-{ts}.log")

        try:
            rc, combined = run_tee(
                cmd,
                repo,
                logfile,
                behaviour.timeout,
                use_tui=use_tui,
                parse_json=parse_json,
            )
        except Exception as exc:
            _ = logfile.write_text(
                f"error: runner failed: {exc.__class__.__name__} {exc}\n",
                encoding="utf-8",
            )
            printferr(f"warn: runner failed: {exc.__class__.__name__} {exc}")
            sleep(behaviour.sleep)
            continue

        if rc != 0:
            printferr(f"warn: runner exited non-zero ({rc}); continuing")

        if sentinelre.search(combined):
            printferr("info: completion sentinel detected; stopping")
            return 0

        prd = load_json(prdfile, PRDTEMPLATE)
        if prd_done(prd):
            printferr("info: all stories pass per prd.json; stopping")
            return 0

        sleep(behaviour.sleep)

    printferr("warn: reached max iterations without completion")
    return 1


if __name__ == "__main__":
    try:
        exit(entry())
    except KeyboardInterrupt:
        printferr("\ninfo: interrupted")
        exit(130)

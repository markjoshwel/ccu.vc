#!/usr/bin/env python3

"""majoralph.py
ralph loop wrapper
------------------
by mark joshwel.co

This is free and unencumbered software released into the public domain.
Anyone is free to copy, modify, publish, use, compile, sell, or distribute
this software, either in source code form or as a compiled binary, for any
purpose, commercial or non-commercial, and by any means.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
For more information, please refer to https://unlicense.org/

what this is
------------
ralph is an outer-loop orchestration pattern: spawn a fresh agent process per
iteration (no in-session loop), persist memory in repo files (prd.json,
progress.txt, AGENTS.md) and git commits, and stop only when tasks are done.

notes
-----
- this script is deliberately runner-agnostic.
- it is also deliberately boring. boring is good.
"""

from __future__ import annotations

from argparse import ArgumentParser
from datetime import datetime
from pathlib import Path
from shutil import copy2, copytree, which
from subprocess import CompletedProcess, run
from sys import stderr, exit
from time import sleep
from typing import Final, NamedTuple

import json
import re


DEFAULTSENTINEL: Final[str] = r"<promise>\s*COMPLETE\s*</promise>"
STATEFOLDERNAME: Final[str] = ".ralph"
ITERPROMPTFILENAME: Final[str] = "iteration_prompt.md"

PRDTEMPLATE: Final[dict] = {
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
- on windows, command-line length is a thing. so the script writes the full prompt to:
    .ralph/iteration_prompt.md
  and passes a short bootstrap message to the agent.
- for opencode, this wrapper also attaches:
    iteration_prompt.md, prd.json, progress.txt
  via --file.
""".strip()


class Behaviour(NamedTuple):
    """namedtuple representing ralph behaviour

    attributes
    repo Path
        repository root to operate in.
    init bool
        initialise prompt.md/prd.json/progress.txt if missing, then exit.
    check bool
        show prd status and warnings, then exit.
    maxiters int
        maximum ralph iterations.
    sleep float
        seconds to sleep between iterations.
    timeout int | None
        per-iteration timeout in seconds.
    sentinel str
        regex to detect completion in runner output.
    promptfile Path
        prompt.md path.
    prdfile Path
        prd.json path.
    progressfile Path
        progress.txt path.
    runner str
        runner name: amp/opencode/custom.
    runnerargs list[str]
        extra args appended to runner command.
    dryrun bool
        print runner command, then exit.
    ampbin str
        amp executable.
    ampallowall bool
        pass --dangerously-allow-all to amp.
    opencodebin str
        opencode executable.
    opencodeformat str
        opencode --format.
    opencodemodel str | None
        opencode --model.
    opencodeagent str | None
        opencode --agent.
    opencodeattach str | None
        opencode --attach.
    customcmd list[str] | None
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


def printferr(*args, **kwargs) -> None:
    """print to stderr

    arguments
    *args
        positional arguments to print.
    **kwargs
        keyword arguments to print.

    returns
    None
        nothing.
    """

    print(*args, file=stderr, **kwargs)


def resolve_exe(exe: str) -> str | None:
    """resolve an executable in a cross-platform way

    arguments
    exe str
        executable name or path.

    returns
    str | None
        resolved path if found, else None.
    """

    found = which(exe)
    if found:
        return found

    if Path(exe).exists():
        return exe

    return None


def detect_available_runner() -> str:
    """detect which runner is available

    returns
    str
        runner name ("amp", "opencode", or "custom").
    """

    if resolve_exe("amp"):
        return "amp"

    if resolve_exe("opencode"):
        return "opencode"

    return "custom"


def ensure_git_repo(repo: Path) -> bool:
    """ensure the working directory is a git repository

    arguments
    repo Path
        repository root.

    returns
    bool
        True if inside git work tree.
    """

    cp = run(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo, capture_output=True, text=True)
    return cp.returncode == 0 and "true" in (cp.stdout or "")


def load_json(path: Path, defaultobj: dict) -> dict:
    """load json from disk, creating the file if missing

    arguments
    path Path
        json file path.
    defaultobj dict
        default object to write if file missing.

    returns
    dict
        json data.

    raises
    RuntimeError
        if json is malformed.
    """

    if not path.exists():
        save_json(path, defaultobj)
        return defaultobj

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid json in {path}: {exc}")


def save_json(path: Path, obj: dict) -> None:
    """save json to disk

    arguments
    path Path
        json file path.
    obj dict
        json object.

    returns
    None
        nothing.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ensure_files(promptfile: Path, prdfile: Path, progressfile: Path) -> None:
    """ensure the required durable state files exist

    arguments
    promptfile Path
        prompt.md path.
    prdfile Path
        prd.json path.
    progressfile Path
        progress.txt path.

    returns
    None
        nothing.
    """

    if not promptfile.exists():
        promptfile.write_text(PROMPTTEMPLATE, encoding="utf-8")

    if not prdfile.exists():
        save_json(prdfile, PRDTEMPLATE)

    if not progressfile.exists():
        progressfile.write_text(
            "# Ralph Progress Log\n" f"Started: {datetime.now().isoformat(timespec='seconds')}\n" "---\n",
            encoding="utf-8",
        )


def prd_stories(prd: dict) -> list[dict]:
    """get stories list from prd, supporting multiple schemas

    arguments
    prd dict
        prd data.

    returns
    list[dict]
        stories.
    """

    if isinstance(prd.get("userStories"), list):
        return prd["userStories"]

    if isinstance(prd.get("stories"), list):
        return prd["stories"]

    return []


def prd_progress(prd: dict) -> tuple[int, int]:
    """return number of completed stories and total stories

    arguments
    prd dict
        prd data.

    returns
    tuple[int, int]
        (done, total).
    """

    s = prd_stories(prd)
    return sum(1 for story in s if story.get("passes")), len(s)


def prd_done(prd: dict) -> bool:
    """check if all stories are passes=true

    arguments
    prd dict
        prd data.

    returns
    bool
        True if all stories pass.
    """

    s = prd_stories(prd)
    return bool(s) and all(bool(story.get("passes")) for story in s)


def prd_branch(prd: dict) -> str:
    """get branch name from prd

    arguments
    prd dict
        prd data.

    returns
    str
        branch name, or empty string.
    """

    return (prd.get("branchName") or prd.get("branch") or "").strip()


def safe_folder_name(name: str) -> str:
    """turn a branch name into a filesystem-safe folder name

    arguments
    name str
        input string.

    returns
    str
        safe string.
    """

    out = name
    for ch in ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]:
        out = out.replace(ch, "_")

    if name.startswith("ralph/"):
        out = safe_folder_name(name[len("ralph/") :])

    return out or "unknown"


def maybe_archive(state: Path, prdfile: Path, progressfile: Path, lastbranchfile: Path) -> None:
    """archive previous run state when branch changes

    arguments
    state Path
        .ralph directory.
    prdfile Path
        prd.json path.
    progressfile Path
        progress.txt path.
    lastbranchfile Path
        file storing last seen branch.

    returns
    None
        nothing.
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
        copy2(prdfile, dest.joinpath(prdfile.name))
        if progressfile.exists():
            copy2(progressfile, dest.joinpath(progressfile.name))
        if logs.exists():
            copytree(logs, dest.joinpath("logs"), dirs_exist_ok=True)

        progressfile.write_text(
            "# Ralph Progress Log\n" f"Started: {datetime.now().isoformat(timespec='seconds')}\n" "---\n",
            encoding="utf-8",
        )

        printferr(f"info: archived previous ralph state to {dest}")

    except Exception as exc:
        printferr(f"warn: failed to archive old state: {exc.__class__.__name__} {exc}")


def ensure_on_branch(repo: Path, branch: str) -> None:
    """check out or create a git branch

    arguments
    repo Path
        repo root.
    branch str
        branch name.

    returns
    None
        nothing.
    """

    if not branch:
        return

    cp = run(["git", "branch", "--show-current"], cwd=repo, capture_output=True, text=True)
    current = (cp.stdout or "").strip()

    if current == branch:
        return

    exists = run(["git", "show-ref", "--verify", f"refs/heads/{branch}"], cwd=repo, capture_output=True, text=True)
    if exists.returncode == 0:
        run(["git", "checkout", branch], cwd=repo)
    else:
        run(["git", "checkout", "-b", branch], cwd=repo)


def build_iteration_prompt(promptfile: Path, prdfile: Path, progressfile: Path, sentinel: str) -> str:
    """build the full iteration prompt

    arguments
    promptfile Path
        prompt.md path.
    prdfile Path
        prd.json path.
    progressfile Path
        progress.txt path.
    sentinel str
        sentinel regex.

    returns
    str
        full prompt.
    """

    base = promptfile.read_text(encoding="utf-8", errors="replace").strip()

    wrapper = (
        "\n\n"
        "RALPH LOOP WRAPPER CONTRACT\n"
        "--------------------------\n"
        "- fresh context each iteration. no chat history.\n"
        f"- durable state: {prdfile.name}, {progressfile.name}, git commits, AGENTS.md.\n"
        "- pick ONE unfinished story (passes=false).\n"
        "- run checks/tests.\n"
        "- commit.\n"
        "- update prd.json + append progress.txt.\n"
        "- when ALL stories are passes=true, print exactly: <promise>COMPLETE</promise>\n"
        f"- wrapper sentinel regex: {sentinel}\n"
    )

    if base:
        return base + wrapper + "\n"

    return wrapper.strip() + "\n"


def runner_command(
    behaviour: Behaviour,
    bootstrapprompt: str,
    iterpromptfile: Path | None = None,
    prdfile: Path | None = None,
    progressfile: Path | None = None,
) -> list[str]:
    """build the runner command token list

    arguments
    behaviour Behaviour
        ralph behaviour.
    bootstrapprompt str
        short prompt passed to the runner.
    iterpromptfile Path | None
        path to .ralph/iteration_prompt.md, attached where supported.
    prdfile Path | None
        path to prd.json, attached where supported.
    progressfile Path | None
        path to progress.txt, attached where supported.

    returns
    list[str]
        subprocess token list.

    raises
    ValueError
        if runner config is invalid.
    """

    if behaviour.runner == "amp":
        cmd = [behaviour.ampbin]
        if behaviour.ampallowall:
            cmd.append("--dangerously-allow-all")
        cmd += ["-x", bootstrapprompt]
        return cmd + list(behaviour.runnerargs)

    if behaviour.runner == "opencode":
        cmd = [
            behaviour.opencodebin,
            "run",
            "--format",
            behaviour.opencodeformat,
        ]

        if behaviour.opencodeattach:
            cmd += ["--attach", behaviour.opencodeattach]
        if behaviour.opencodemodel:
            cmd += ["--model", behaviour.opencodemodel]
        if behaviour.opencodeagent:
            cmd += ["--agent", behaviour.opencodeagent]

        files: list[str] = []
        if iterpromptfile is not None:
            files.append(str(iterpromptfile))
        if prdfile is not None:
            files.append(str(prdfile))
        if progressfile is not None:
            files.append(str(progressfile))

        if files:
            cmd += ["--file", *files]

        # CRITICAL: stop --file (array) from eating the message
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


def create_parser(defaultrunner: str) -> ArgumentParser:
    """create the argument parser

    arguments
    defaultrunner str
        default runner to use.

    returns
    ArgumentParser
        configured parser.
    """

    parser = ArgumentParser(
        description="ralph loop wrapper (fresh process per iteration, durable state in files)",
        epilog=HELPEPILOG,
        formatter_class=lambda prog: __import__("argparse").RawDescriptionHelpFormatter(prog),
    )

    parser.add_argument("--repo", type=Path, default=Path("."), help="repo root (default: .)")
    parser.add_argument("--init", action="store_true", help="create prompt/prd/progress files if missing, then exit")
    parser.add_argument("--check", action="store_true", help="print prd status and warnings, then exit")

    parser.add_argument("--max-iters", type=int, default=10, help="maximum iterations (default: 10)")
    parser.add_argument("--sleep", type=float, default=2.0, help="sleep seconds between iterations (default: 2.0)")
    parser.add_argument("--timeout", type=int, default=None, help="per-iteration timeout seconds (default: none)")
    parser.add_argument("--sentinel", type=str, default=DEFAULTSENTINEL, help="completion sentinel regex")

    parser.add_argument("--prompt-file", type=Path, default=Path("prompt.md"), help="prompt file (default: prompt.md)")
    parser.add_argument("--prd", type=Path, default=Path("prd.json"), help="prd file (default: prd.json)")
    parser.add_argument("--progress", type=Path, default=Path("progress.txt"), help="progress file (default: progress.txt)")

    parser.add_argument("--runner", choices=["amp", "opencode", "custom"], default=defaultrunner)
    parser.add_argument("--runner-arg", action="append", default=[], help="extra args appended to runner (repeatable)")
    parser.add_argument("--dry-run", action="store_true", help="print runner command tokens, then exit")

    # amp
    parser.add_argument("--amp-bin", type=str, default="amp")
    parser.add_argument("--amp-allow-all", action="store_true")

    # opencode
    parser.add_argument("--opencode-bin", type=str, default="opencode")
    parser.add_argument("--opencode-format", type=str, default="default", choices=["default", "json"])
    parser.add_argument("--opencode-model", type=str, default=None)
    parser.add_argument("--opencode-agent", type=str, default=None)
    parser.add_argument("--opencode-attach", type=str, default=None)

    # custom
    parser.add_argument("--custom-cmd", nargs="+", default=None, help="custom runner command tokens")

    return parser


def handle_args(argv: list[str] | None = None) -> Behaviour:
    """handle command-line arguments

    arguments
    argv list[str] | None
        argument vector; if None, uses sys.argv implicitly.

    returns
    Behaviour
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


def append_text(path: Path, text: str) -> None:
    """append text to a file

    arguments
    path Path
        file to append to.
    text str
        text to append.

    returns
    None
        nothing.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(text)


def entry() -> int:
    """command-line entry point

    returns
    int
        process exit code.
    """

    behaviour = handle_args()

    repo = behaviour.repo.resolve()
    if not ensure_git_repo(repo):
        printferr("error: not a git repository (run from a repo root)")
        return 2

    promptfile = repo.joinpath(behaviour.promptfile)
    prdfile = repo.joinpath(behaviour.prdfile)
    progressfile = repo.joinpath(behaviour.progressfile)

    ensure_files(promptfile, prdfile, progressfile)

    state = repo.joinpath(STATEFOLDERNAME)
    logs = state.joinpath("logs")
    archives = state.joinpath("archive")
    lastbranchfile = state.joinpath(".last-branch")
    iterpromptfile = state.joinpath(ITERPROMPTFILENAME)

    logs.mkdir(parents=True, exist_ok=True)
    archives.mkdir(parents=True, exist_ok=True)

    # resolve runner binary early so the failure mode prints --help immediately.
    if behaviour.runner == "amp":
        resolved = resolve_exe(behaviour.ampbin)
        if not resolved:
            printferr(f"error: amp executable not found: {behaviour.ampbin!r}")
            return 2
        behaviour = behaviour._replace(ampbin=resolved)

    elif behaviour.runner == "opencode":
        resolved = resolve_exe(behaviour.opencodebin)
        if not resolved:
            printferr(f"error: opencode executable not found: {behaviour.opencodebin!r}")
            return 2
        behaviour = behaviour._replace(opencodebin=resolved)

    elif behaviour.runner == "custom":
        if not behaviour.customcmd:
            printferr("error: custom runner requires --custom-cmd")
            return 2

        resolved = resolve_exe(behaviour.customcmd[0])
        if not resolved:
            printferr(f"error: custom runner executable not found: {behaviour.customcmd[0]!r}")
            return 2

        behaviour = behaviour._replace(customcmd=[resolved, *behaviour.customcmd[1:]])

    if behaviour.init:
        printferr(f"info: initialised {promptfile} {prdfile} {progressfile}")
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
        lastbranchfile.write_text(branch + "\n", encoding="utf-8")

    sentinelre = re.compile(behaviour.sentinel, re.IGNORECASE)

    # keep bootstrap prompt small; point runner at iterpromptfile
    # do not include the sentinel token in this bootstrap prompt, because some runners
    # echo it in errors and would trigger an early stop.
    bootstrapprompt = (
        "Read and follow the attached iteration prompt file. "
        "Also read the attached prd.json and progress.txt. "
        "The iteration prompt contains the exact completion marker to print when done."
    )

    for i in range(1, behaviour.maxiters + 1):
        prd = load_json(prdfile, PRDTEMPLATE)
        done, total = prd_progress(prd)

        if prd_done(prd):
            printferr("info: all stories pass; stopping")
            return 0

        # refresh prompt file (user may edit prompt.md while ralph is running)
        iterpromptfile.write_text(
            build_iteration_prompt(promptfile, prdfile, progressfile, behaviour.sentinel),
            encoding="utf-8",
        )

        cmd = runner_command(behaviour, bootstrapprompt, iterpromptfile, prdfile, progressfile)

        if behaviour.dryrun:
            printferr("info: dry run command tokens:")
            for token in cmd:
                printferr(token)
            return 0

        printferr(f"info: iteration {i}/{behaviour.maxiters} [{done}/{total}]")
        append_text(progressfile, f"\n--- Iteration {i} started: {datetime.now().isoformat(timespec='seconds')} ---\n")

        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        logfile = logs.joinpath(f"iter-{i:04d}-{ts}.log")

        try:
            cp: CompletedProcess[str] = run(cmd, cwd=repo, capture_output=True, text=True, timeout=behaviour.timeout)
        except Exception as exc:
            logfile.write_text(f"error: runner failed: {exc.__class__.__name__} {exc}\n", encoding="utf-8")
            printferr(f"warn: runner failed: {exc.__class__.__name__} {exc}")
            sleep(behaviour.sleep)
            continue

        combined = (cp.stdout or "") + "\n" + (cp.stderr or "")
        logfile.write_text(combined, encoding="utf-8")

        # stop condition: sentinel in output
        if sentinelre.search(combined):
            printferr("info: completion sentinel detected; stopping")
            return 0

        # stop condition: prd says all passes
        prd = load_json(prdfile, PRDTEMPLATE)
        if prd_done(prd):
            printferr("info: all stories pass per prd.json; stopping")
            return 0

        sleep(behaviour.sleep)

    printferr("warn: reached max iterations without completion")
    return 1


def read_text(path: Path) -> str:
    """read text from a file

    arguments
    path Path
        file to read.

    returns
    str
        file content.
    """

    if not path.exists():
        return ""

    return path.read_text(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    try:
        exit(entry())
    except KeyboardInterrupt:
        printferr("\ninfo: interrupted")
        exit(130)

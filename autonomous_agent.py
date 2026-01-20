"""
Production-ready autonomous code agent:
- Clones repo
- Generates code into generated/
- Commits + pushes branch
- Opens PR
- (Optional) deploys to Vercel via CLI

Env required:
  GITHUB_TOKEN, OPENAI_API_KEY, REPO (e.g. "owner/name")

Optional:
  OPENAI_MODEL (default: "gpt-4o-mini")
  WORKDIR (default: ".work")
  GENERATED_DIR (default: "generated")
  VERBOSE (default: "0")

Usage (local):
  python autonomous_agent.py analyze
  python autonomous_agent.py generate --feature "Add /health endpoint"
  python autonomous_agent.py run --feature "Add /health endpoint" --deploy
  python autonomous_agent.py run --feature "..." --deploy --prod

GitHub Actions: see workflow at bottom of this code block.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from github import Github  # PyGithub
import openai  # openai>=1.x


EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".pytest_cache",
    ".mypy_cache",
}


LANG_BY_EXT = {
    ".py": "Python",
    ".js": "JavaScript",
    ".ts": "TypeScript",
    ".jsx": "React",
    ".tsx": "React TypeScript",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".cs": "C#",
    ".cpp": "C++",
    ".c": "C",
    ".rb": "Ruby",
    ".php": "PHP",
    ".kt": "Kotlin",
    ".swift": "Swift",
    ".sql": "SQL",
    ".yml": "YAML",
    ".yaml": "YAML",
    ".json": "JSON",
    ".md": "Markdown",
    ".sh": "Shell",
    ".toml": "TOML",
}


@dataclasses.dataclass(frozen=True)
class Settings:
    github_token: str
    openai_api_key: str
    repo: str
    openai_model: str
    workdir: Path
    generated_dir: Path
    verbose: bool

    @staticmethod
    def from_env() -> "Settings":
        def need(name: str) -> str:
            v = os.getenv(name)
            if not v:
                raise RuntimeError(f"Missing required env var: {name}")
            return v

        github_token = need("GITHUB_TOKEN")
        openai_api_key = need("OPENAI_API_KEY")
        repo = need("REPO")

        openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        workdir = Path(os.getenv("WORKDIR", ".work")).resolve()
        generated_dir = Path(os.getenv("GENERATED_DIR", "generated"))
        verbose = os.getenv("VERBOSE", "0") == "1"

        return Settings(
            github_token=github_token,
            openai_api_key=openai_api_key,
            repo=repo,
            openai_model=openai_model,
            workdir=workdir,
            generated_dir=generated_dir,
            verbose=verbose,
        )


class CmdError(RuntimeError):
    pass


def run_cmd(
    args: List[str],
    cwd: Optional[Path] = None,
    env: Optional[Dict[str, str]] = None,
    check: bool = True,
) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        env={**os.environ, **(env or {})},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if check and proc.returncode != 0:
        raise CmdError(
            f"Command failed ({proc.returncode}): {' '.join(args)}\n"
            f"--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}"
        )
    return proc


def setup_logging(verbose: bool) -> None:
    lvl = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=lvl,
        format="%(asctime)s %(levelname)s %(message)s",
    )


def safe_slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", s).strip("-").lower()


class OpenAIHelper:
    def __init__(self, api_key: str, model: str) -> None:
        self.client = openai.OpenAI(api_key=api_key)
        self.model = model

    def chat(self, system: str, user: str, max_tokens: int = 2000, temperature: float = 0.4) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return resp.choices[0].message.content or ""

    def chat_json(self, system: str, user: str, max_tokens: int = 3500) -> Dict[str, Any]:
        """
        Best-effort JSON-only response parser with retries + JSON extraction.
        """
        last: str = ""
        for attempt in range(1, 4):
            prompt = (
                user
                + "\n\nIMPORTANT: Return ONLY valid JSON. No markdown. No code fences. No commentary."
            )
            last = self.chat(system=system, user=prompt, max_tokens=max_tokens, temperature=0.2)
            try:
                return json.loads(last)
            except json.JSONDecodeError:
                extracted = extract_json_object(last)
                if extracted is not None:
                    return extracted
                logging.warning("JSON parse failed (attempt %s). Retrying...", attempt)
        raise RuntimeError(f"Model did not return valid JSON after retries. Last output:\n{last}")


def extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """
    Extract first JSON object in text by brace matching.
    """
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                snippet = text[start : i + 1]
                try:
                    return json.loads(snippet)
                except json.JSONDecodeError:
                    return None
    return None


class RepoWorkspace:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.github = Github(settings.github_token)
        self.repo = self.github.get_repo(settings.repo)
        self.default_branch = self.repo.default_branch
        self.local_path = settings.workdir / safe_slug(settings.repo)

    def ensure(self) -> None:
        self.settings.workdir.mkdir(parents=True, exist_ok=True)

        if not self.local_path.exists():
            logging.info("Cloning %s into %s", self.settings.repo, self.local_path)
            clone_url = self.repo.clone_url
            # Auth via token to allow push from CI.
            clone_url_auth = clone_url.replace("https://", f"https://x-access-token:{self.settings.github_token}@")
            run_cmd(["git", "clone", "--depth", "1", "--branch", self.default_branch, clone_url_auth, str(self.local_path)])
        else:
            logging.info("Fetching latest for %s", self.local_path)
            run_cmd(["git", "fetch", "--all", "--prune"], cwd=self.local_path)
            run_cmd(["git", "checkout", self.default_branch], cwd=self.local_path)
            run_cmd(["git", "reset", "--hard", f"origin/{self.default_branch}"], cwd=self.local_path)

    def list_files(self) -> List[Path]:
        files: List[Path] = []
        for p in self.local_path.rglob("*"):
            if not p.is_file():
                continue
            if any(part in EXCLUDE_DIRS for part in p.parts):
                continue
            files.append(p)
        return files

    def write_generated_files(self, file_specs: List[Dict[str, str]]) -> List[Path]:
        out_root = self.local_path / self.settings.generated_dir
        if out_root.exists():
            shutil.rmtree(out_root)
        out_root.mkdir(parents=True, exist_ok=True)

        written: List[Path] = []
        for spec in file_specs:
            rel = spec["path"].lstrip("/").replace("..", "")
            dest = out_root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(spec["content"], encoding="utf-8")
            written.append(dest)
        return written

    def create_branch_commit_push(self, branch: str, commit_msg: str) -> None:
        run_cmd(["git", "checkout", "-B", branch], cwd=self.local_path)
        run_cmd(["git", "add", str(self.settings.generated_dir)], cwd=self.local_path)
        status = run_cmd(["git", "status", "--porcelain"], cwd=self.local_path).stdout.strip()
        if not status:
            raise RuntimeError("No changes to commit (generated output identical).")
        run_cmd(["git", "commit", "-m", commit_msg], cwd=self.local_path)
        run_cmd(["git", "push", "-u", "origin", branch, "--force"], cwd=self.local_path)

    def open_pr(self, branch: str, title: str, body: str) -> str:
        pr = self.repo.create_pull(
            title=title,
            body=body,
            head=branch,
            base=self.default_branch,
        )
        return pr.html_url


def detect_language(path: Path) -> Optional[str]:
    return LANG_BY_EXT.get(path.suffix.lower())


def summarize_repo(files: List[Path], root: Path, max_items: int = 200) -> Dict[str, Any]:
    items = []
    lang_counts: Dict[str, int] = {}
    total_bytes = 0

    for p in files[:max_items]:
        rel = p.relative_to(root).as_posix()
        size = p.stat().st_size
        total_bytes += size
        lang = detect_language(p)
        if lang:
            lang_counts[lang] = lang_counts.get(lang, 0) + 1
        items.append({"path": rel, "size": size, "language": lang})

    return {
        "sampled_files": items,
        "language_counts": dict(sorted(lang_counts.items(), key=lambda kv: kv[1], reverse=True)),
        "sampled_count": len(items),
        "total_sampled_bytes": total_bytes,
    }


class AutonomousAgent:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.ws = RepoWorkspace(settings)
        self.ai = OpenAIHelper(settings.openai_api_key, settings.openai_model)

    def analyze(self) -> Dict[str, Any]:
        self.ws.ensure()
        files = self.ws.list_files()
        summary = summarize_repo(files, self.ws.local_path)

        system = "You are a senior software architect. Be direct, specific, and production-minded."
        user = (
            "Analyze this repository snapshot and suggest:\n"
            "1) performance improvements\n"
            "2) security risks\n"
            "3) productizable features\n"
            "4) quick wins for reliability\n\n"
            f"Repo: {self.settings.repo}\n"
            f"Default branch: {self.ws.default_branch}\n"
            f"File sample JSON:\n{json.dumps(summary, indent=2)}\n"
        )
        suggestions = self.ai.chat(system=system, user=user, max_tokens=1200, temperature=0.3)

        return {
            "repo": self.settings.repo,
            "default_branch": self.ws.default_branch,
            "summary": summary,
            "suggestions": suggestions,
        }

    def generate_feature(self, feature: str) -> Dict[str, Any]:
        self.ws.ensure()
        files = self.ws.list_files()
        summary = summarize_repo(files, self.ws.local_path)

        system = "You are an expert engineer. Output must be safe, testable, and minimal-diff oriented."

        plan = self.ai.chat(
            system=system,
            user=(
                f"Create an implementation plan for this feature:\n{feature}\n\n"
                "Constraints:\n"
                "- Keep changes self-contained under generated/.\n"
                "- Include README.md with run instructions.\n"
                "- Prefer FastAPI for Python APIs.\n"
                "- Include tests if feasible.\n\n"
                f"Repo snapshot:\n{json.dumps(summary, indent=2)}"
            ),
            max_tokens=1200,
            temperature=0.3,
        )

        spec = self.ai.chat_json(
            system=system,
            user=(
                f"Using this plan:\n{plan}\n\n"
                "Generate files as JSON:\n"
                '{ "files": [ { "path": "relative/path", "content": "file content", "description": "what" } ] }\n\n'
                "Rules:\n"
                "- Every file path must be relative and must NOT start with '/'.\n"
                "- Put everything under generated/ (you may include generated/README.md, generated/api/main.py, etc.).\n"
                "- Include requirements.txt or pyproject.toml if Python.\n"
                "- Include a minimal CI-friendly test command in README.\n"
                f"Feature:\n{feature}\n"
            ),
            max_tokens=3500,
        )

        files_spec = spec.get("files")
        if not isinstance(files_spec, list) or not files_spec:
            raise RuntimeError("Model JSON missing 'files' list.")

        normalized: List[Dict[str, str]] = []
        for f in files_spec:
            if not isinstance(f, dict):
                continue
            path = str(f.get("path", "")).strip()
            content = str(f.get("content", ""))
            desc = str(f.get("description", ""))
            if not path:
                continue
            # Force under generated/
            path = path.lstrip("/")
            if not path.startswith("generated/"):
                path = "generated/" + path
            normalized.append({"path": path.replace("\\", "/"), "content": content, "description": desc})

        written = self.ws.write_generated_files(normalized)

        return {
            "feature": feature,
            "plan": plan,
            "files_written": [p.relative_to(self.ws.local_path).as_posix() for p in written],
        }

    def run_tests_if_present(self) -> None:
        """
        Runs pytest if pytest + tests exist under generated/.
        """
        root = self.ws.local_path
        gen = root / self.settings.generated_dir

        if not gen.exists():
            logging.info("No generated/ directory to test.")
            return

        has_py = any(p.suffix == ".py" for p in gen.rglob("*.py"))
        if not has_py:
            logging.info("No Python code under generated/. Skipping tests.")
            return

        req = gen / "requirements.txt"
        if req.exists():
            logging.info("Installing generated requirements.txt")
            run_cmd([sys.executable, "-m", "pip", "install", "-r", str(req)], cwd=root)

        # run pytest if tests folder exists
        tests_dir = gen / "tests"
        if tests_dir.exists():
            logging.info("Running pytest")
            run_cmd([sys.executable, "-m", "pytest", str(tests_dir)], cwd=root)
        else:
            logging.info("No generated/tests found. Skipping pytest.")

    def create_pr(self, feature: str, branch_prefix: str = "agent") -> str:
        now = dt.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        branch = f"{branch_prefix}/{safe_slug(feature)[:40]}-{now}"
        commit_msg = f"Agent: {feature}"
        self.ws.create_branch_commit_push(branch=branch, commit_msg=commit_msg)

        body = (
            f"## Feature\n{feature}\n\n"
            f"## Output\nGenerated under `{self.settings.generated_dir}/`.\n\n"
            "## Notes\n- Please review before merging.\n"
        )
        pr_url = self.ws.open_pr(branch=branch, title=f"Agent build: {feature}", body=body)
        return pr_url

    def deploy_vercel(self, prod: bool = False) -> str:
        """
        Requires Vercel CLI installed and VERCEL_TOKEN set (or interactive auth).
        Deploys generated/ as project root.
        """
        root = self.ws.local_path
        gen = root / self.settings.generated_dir
        if not gen.exists():
            raise RuntimeError("generated/ does not exist. Generate first.")

        if shutil.which("vercel") is None:
            raise RuntimeError("Vercel CLI not found. Install: npm i -g vercel")

        logging.info("Vercel deploy (%s)", "prod" if prod else "preview")

        env = {}
        token = os.getenv("VERCEL_TOKEN")
        if token:
            env["VERCEL_TOKEN"] = token

        # Ensure project is linked (non-interactive if token + ids set)
        # If you set VERCEL_ORG_ID and VERCEL_PROJECT_ID, Vercel can deploy non-interactively.
        # Otherwise first run may require linking.
        args = ["vercel", "deploy", "--yes"]
        if token:
            args += ["--token", token]
        if prod:
            args.append("--prod")

        proc = run_cmd(args, cwd=gen, env=env, check=True)
        url = ""
        for line in proc.stdout.splitlines():
            line = line.strip()
            if line.startswith("https://") and "vercel.app" in line:
                url = line
        return url or "Vercel deploy succeeded (URL not parsed). Check CLI output."

    def run(self, feature: str, deploy: bool, prod: bool) -> Dict[str, Any]:
        analysis = self.analyze()
        gen = self.generate_feature(feature)
        self.run_tests_if_present()
        pr_url = self.create_pr(feature)
        deploy_url = ""
        if deploy:
            deploy_url = self.deploy_vercel(prod=prod)

        return {
            "analysis": analysis,
            "generation": gen,
            "pr_url": pr_url,
            "deploy_url": deploy_url,
        }


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Autonomous GitHub + OpenAI code agent")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("analyze", help="Analyze repo and print suggestions")

    g = sub.add_parser("generate", help="Generate feature into generated/")
    g.add_argument("--feature", required=True)

    r = sub.add_parser("run", help="Analyze + generate + test + PR (+ optional deploy)")
    r.add_argument("--feature", required=True)
    r.add_argument("--deploy", action="store_true", help="Deploy to Vercel after PR creation")
    r.add_argument("--prod", action="store_true", help="Deploy to Vercel production (requires --deploy)")

    d = sub.add_parser("deploy", help="Deploy current generated/ to Vercel")
    d.add_argument("--prod", action="store_true")

    return p


def main() -> None:
    settings = Settings.from_env()
    setup_logging(settings.verbose)

    agent = AutonomousAgent(settings)
    args = build_arg_parser().parse_args()

    if args.cmd == "analyze":
        out = agent.analyze()
        print(json.dumps(out, indent=2))
        return

    if args.cmd == "generate":
        out = agent.generate_feature(args.feature)
        print(json.dumps(out, indent=2))
        return

    if args.cmd == "deploy":
        agent.ws.ensure()
        url = agent.deploy_vercel(prod=bool(args.prod))
        print(url)
        return

    if args.cmd == "run":
        out = agent.run(feature=args.feature, deploy=bool(args.deploy), prod=bool(args.prod))
        print(json.dumps(out, indent=2))
        return

    raise RuntimeError("Unknown command")


if __name__ == "__main__":
    main()

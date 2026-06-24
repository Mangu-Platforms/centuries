# AGENTS.md

## Cursor Cloud specific instructions

### What this project is
A single-file Python CLI tool (`autonomous_agent.py`) packaged as a composite GitHub
Action (`action.yml`, `.github/workflows/autonomous-agent.yml`). It uses the OpenAI API
(`openai`) and the GitHub API (`PyGithub`) to analyze a repo, generate code under
`generated/`, run optional tests, and open a PR. There is no GUI and no web server.

### Environment
- Python 3.12 is used locally (CI pins 3.11). Dependencies live in `requirements.txt`
  (`openai`, `PyGithub`, `pytest`) and are installed into a project venv at `./venv`
  (gitignored). The startup update script refreshes this venv, so you normally don't
  need to reinstall. Activate with `. venv/bin/activate`.

### Lint / test / build / run
- Lint: no linter is configured. Use `python -m py_compile autonomous_agent.py` as a
  syntax check.
- Test: `python -m pytest -q`. There are currently no test files, so pytest exits with
  code 5 ("no tests ran") — that is expected, not a failure.
- Build: nothing to build (single script + composite action).
- Run: `python autonomous_agent.py {analyze|generate|run|deploy} ...` (see the module
  docstring for usage).

### Non-obvious gotchas
- `main()` calls `Settings.from_env()` which REQUIRES `GITHUB_TOKEN`, `OPENAI_API_KEY`,
  and `REPO` (e.g. `owner/name`); it raises `RuntimeError: Missing required env var: ...`
  if any are absent. These are NOT preconfigured in the cloud VM — add them as Secrets to
  run the real pipeline.
- `AutonomousAgent` is constructed BEFORE argparse runs, and its constructor calls
  `Github.get_repo(REPO)` (a network call). So even `--help` will fail without valid
  credentials and network access. To exercise core logic offline, import the module and
  call the pure functions directly (`summarize_repo`, `extract_json_object`, `safe_slug`,
  `detect_language`, `build_arg_parser`).
- Running `analyze`/`generate`/`run` makes live OpenAI + GitHub API calls (and `run`
  force-pushes a branch and opens a PR on the target `REPO`). Do not run these against a
  real repo unless that is the intent.

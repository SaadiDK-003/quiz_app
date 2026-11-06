#!/usr/bin/env python3
"""Focused, disposable checks for the standalone deployer's terminal interface."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import signal
import struct
import subprocess
import tempfile
import termios
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "deploy-vps.sh"
ESCAPES = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def shell(code, *, env=None, check=False):
    prefix = f"set -Eeuo pipefail\numask 077\nsource {shlex.quote(str(SCRIPT))}\n"
    prefix += "UI_PLAIN=1; UI_STARTED=$SECONDS; STAGE=0; LOG_FILE=''; ui_init\n"
    return subprocess.run(["bash", "-c", prefix + code], capture_output=True, text=True,
                          env={**os.environ, **(env or {})}, check=check)


def terminal(command, *, width=80, env=None):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, width, 0, 0))
    environment = {**os.environ, "TERM": "xterm-256color", "LC_ALL": "C.UTF-8"}
    environment.pop("NO_COLOR", None)
    environment.pop("COLUMNS", None)
    environment.update(env or {})
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=slave, stderr=slave, env=environment)
    os.close(slave)
    data = bytearray()
    deadline = time.monotonic() + 15
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], .2)
            if ready:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not chunk:
                    break
                data.extend(chunk)
            elif process.poll() is not None:
                break
        else:
            process.kill()
            raise AssertionError("Terminal fixture timed out")
        return process.wait(timeout=2), data.decode("utf-8", "replace")
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
            process.wait()


class PreviewTests(unittest.TestCase):
    def test_preview_is_root_free_and_does_not_call_deployment_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            guard = Path(temp)
            trace = guard / "called"
            for name in ("git", "docker", "python3", "curl", "nginx", "systemctl", "apt-get", "install", "date", "sudo"):
                file = guard / name
                file.write_text(f"#!/bin/sh\nprintf '%s\\n' '{name}' >> '{trace}'\nexit 91\n")
                file.chmod(0o755)
            result = subprocess.run(["/bin/bash", str(SCRIPT), "--preview-ui", "--plain"],
                                    env={**os.environ, "PATH": temp, "TERM": "dumb"}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("PREVIEW / NO CHANGES", result.stdout)
            self.assertIn("EXAMPLE / DEPLOYMENT COMPLETE", result.stdout)
            self.assertIn("EXAMPLE / DEPLOYMENT STOPPED", result.stdout)
            self.assertFalse(trace.exists(), trace.read_text() if trace.exists() else "")

    def test_piped_output_is_ascii_without_escape_codes_and_wraps_narrow_text(self):
        result = subprocess.run(["bash", str(SCRIPT), "--preview-ui"],
                                env={**os.environ, "COLUMNS": "42", "TERM": "xterm"}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.isascii())
        self.assertNotIn("\x1b", result.stdout)
        for line in result.stdout.splitlines():
            if line.startswith("    sudo bash"):
                continue  # Copyable commands retain their complete shell line.
            self.assertLessEqual(len(line), 42, line)

    def test_tty_supports_colour_unicode_no_color_plain_and_ascii_locales(self):
        command = ["bash", str(SCRIPT), "--preview-ui"]
        code, coloured = terminal(command)
        self.assertEqual(code, 0)
        self.assertIn("\x1b[", coloured)
        self.assertIn("╭", coloured)
        code, no_colour = terminal(command, env={"NO_COLOR": "1"})
        self.assertEqual(code, 0)
        self.assertNotIn("\x1b", no_colour)
        self.assertIn("╭", no_colour)
        code, plain = terminal(command + ["--plain"], width=42)
        self.assertEqual(code, 0)
        self.assertTrue(plain.isascii())
        self.assertNotIn("\x1b", plain)
        for line in plain.splitlines():
            if not line.startswith("    sudo bash"):
                self.assertLessEqual(len(line), 42, line)
        code, ascii_locale = terminal(command, env={"LC_ALL": "C"})
        self.assertEqual(code, 0)
        self.assertTrue(ESCAPES.sub("", ascii_locale).isascii())

    def test_embedded_python_blocks_compile(self):
        blocks = re.findall(r"<<'PY'\n(.*?)\nPY", SCRIPT.read_text(), re.DOTALL)
        self.assertGreater(len(blocks), 5)
        for number, block in enumerate(blocks):
            compile(block, f"embedded-block-{number}", "exec")


class GitReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "checkout"
        self.repo.mkdir()
        (self.root / "shared").mkdir()
        self.state = self.root / "shared/current.json"
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.test")
        self.git("config", "user.name", "Quiz fixture")
        self.git("config", "color.ui", "always")
        (self.repo / "modified.txt").write_text("before\n")
        (self.repo / "removed.txt").write_text("removed\n")
        (self.repo / "old-name.txt").write_text("A long enough unchanged rename fixture\n" * 12)
        (self.repo / "binary.dat").write_bytes(b"\0before")
        self.git("add", ".")
        self.git("commit", "-qm", "Initial fixture")
        self.base = self.git("rev-parse", "HEAD").strip()
        (self.repo / "modified.txt").write_text("after\nnew line\n")
        (self.repo / "removed.txt").unlink()
        self.git("mv", "old-name.txt", "renamed name.txt")
        (self.repo / "binary.dat").write_bytes(b"\0after")
        (self.repo / "added.txt").write_text("new\n")
        (self.repo / "odd\tname\n\x1b[31m.txt").write_text("odd\n")
        (self.repo / ("long-" + "x" * 100 + ".txt")).write_text("long\n")
        (self.repo / "unicode-\u202e-file.txt").write_text("unicode\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Update fixture password=HIDDEN_PASSWORD ghp_HIDDEN_TOKEN https://user:HIDDEN_URL@github.com/x")
        self.target = self.git("rev-parse", "HEAD").strip()
        self.state.write_text(json.dumps({"commit": self.base}))

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True, stderr=subprocess.DEVNULL)

    def report(self):
        result = shell(f"ROOT={shlex.quote(str(self.root))}; SOURCE_DIR={shlex.quote(str(self.repo))}; "
                       f"COMMIT={self.target}; release_changes; printf 'RESULT=%s\\n' \"$CHANGE_COUNT\"")
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_pre_pulled_checkout_compares_with_deployed_commit_and_lists_all_files(self):
        self.assertEqual(self.git("rev-parse", "HEAD").strip(), self.target)
        before = self.state.read_bytes()
        output = self.report()
        self.assertIn(self.base[:12], output)
        self.assertIn(self.target[:12], output)
        self.assertIn("RESULT=8", output)
        self.assertIn('+ "added.txt"', output)
        self.assertIn('- "removed.txt"', output)
        self.assertIn('~ "modified.txt"', output)
        self.assertIn('> "old-name.txt" -> "renamed name.txt"', output)
        self.assertIn("1 binary files", output)
        self.assertIn('"binary.dat" [binary]', output)
        self.assertIn("odd", output)
        self.assertIn("unicode", output)
        self.assertNotIn("\x1b", output)
        for secret in ("HIDDEN_PASSWORD", "HIDDEN_TOKEN", "HIDDEN_URL"):
            self.assertNotIn(secret, output)
        self.assertEqual(self.git("status", "--porcelain"), "")
        self.assertEqual(self.state.read_bytes(), before)

    def test_header_separates_successful_and_pending_releases_without_environment_data(self):
        config = self.root / "shared/deployments/candidate/compose.json"
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({"services": {"api": {"image": "webostics-quiz-api:" + self.target,
            "environment": {"DB_PASSWORD": "HIDDEN_CONTEXT_SECRET"}}}}))
        (self.root / "shared/pending.json").write_text(json.dumps({"config": str(config)}))
        result = shell(f"ROOT={shlex.quote(str(self.root))}; SOURCE_DIR={shlex.quote(str(self.repo))}; "
                       "DOMAIN=quiz.webostics.com; MODE=status; ui_release_context; ui_header")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Last successful release: " + self.base[:12], result.stdout)
        self.assertIn("Pending release: " + self.target[:12], result.stdout)
        self.assertNotIn("HIDDEN_CONTEXT_SECRET", result.stdout)

    def test_identical_release_is_reported_as_zero_changes(self):
        self.state.write_text(json.dumps({"commit": self.target}))
        output = self.report()
        self.assertIn("Already up to date", output)
        self.assertIn("RESULT=0", output)

    def test_missing_or_invalid_baseline_is_unavailable_not_zero(self):
        for commit in ("0" * 40, "ghp_HIDDEN_TOKEN", None):
            self.state.write_text(json.dumps({"commit": commit}))
            output = self.report()
            self.assertIn("RESULT=Unavailable", output)
            self.assertNotIn("0 changed files", output)
            self.assertNotIn("HIDDEN_TOKEN", output)

    def test_initial_installation_lists_inventory_without_a_false_line_comparison(self):
        self.state.unlink()
        output = self.report()
        self.assertIn("Initial installation", output)
        self.assertIn("initial inventory", output)
        self.assertIn("line comparison not applicable", output)
        self.assertIn('"added.txt"', output)

    def test_commit_subjects_are_limited_to_five(self):
        for i in range(7):
            self.git("commit", "--allow-empty", "-qm", f"Extra fixture commit {i}")
        self.target = self.git("rev-parse", "HEAD").strip()
        output = self.report()
        self.assertEqual(output.count("Extra fixture commit"), 5)
        self.assertIn("8 commits", output)

    def test_missing_checkout_still_allows_saved_release_resume_reporting(self):
        result = shell(f"ROOT={shlex.quote(str(self.root))}; SOURCE_DIR={shlex.quote(str(self.root / 'missing'))}; "
                       f"COMMIT={self.target}; release_changes; printf 'RESULT=%s\\n' \"$CHANGE_COUNT\"")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("unavailable locally", result.stdout)
        self.assertIn("RESULT=Unavailable", result.stdout)


class TaskRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = self.root / "private.log"
        self.log.touch(mode=0o600)
        self.prefix = (f"ROOT={shlex.quote(str(self.root))}; LOG_FILE={shlex.quote(str(self.log))}; "
                       "MODE=deploy; TOTAL_STAGES=10; MIGRATION_STARTED=0; QUIESCED=0; NGINX_CHANGED=0; "
                       "TASK_PID=''; BUILDER_ACTIVE=0; RUN_DIR=''; CANDIDATE_CONFIG=''; OLD_CONFIG=''; "
                       "trap cleanup EXIT; trap 'on_error $? $LINENO' ERR; trap 'on_error 143 $LINENO' TERM; ")

    def test_quiet_build_heartbeat_is_curated_and_private_output_stays_private(self):
        code = self.prefix + r'''
sleep() { SECONDS=$((SECONDS + 31)); command sleep .04; }
RUN_KIND=build run 'Next.js image' bash -c '
  echo "MAIL_PASSWORD=HIDDEN_BUILD_SECRET"
  echo "#12 [builder 3/6] RUN token=HIDDEN_COMMAND_SECRET"
  echo "#13 [ghp_HIDDEN_STAGE 2/3] RUN echo private"
  echo "HIDDEN_STDERR_SECRET" >&2
  sleep .35
'
'''
        result = shell(code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("still working", result.stdout)
        self.assertIn("BuildKit #13 / image stage step 2/3", result.stdout)
        self.assertNotIn("HIDDEN_", result.stdout + result.stderr)
        self.assertIn("HIDDEN_BUILD_SECRET", self.log.read_text())
        self.assertEqual(self.log.stat().st_mode & 0o777, 0o600)

    def test_failed_task_preserves_exit_status_and_reports_once(self):
        result = shell(self.prefix + "step 'Build images'; run 'Failing fixture' bash -c 'echo HIDDEN_FAILURE_SECRET >&2; exit 37'")
        self.assertEqual(result.returncode, 37)
        self.assertIn("Exit status: 37", result.stdout)
        self.assertEqual(result.stdout.count("DEPLOYMENT STOPPED"), 1)
        self.assertNotIn("HIDDEN_FAILURE_SECRET", result.stdout + result.stderr)
        self.assertIn("HIDDEN_FAILURE_SECRET", self.log.read_text())
        self.assertIn("[FAILURE]", self.log.read_text())

    def test_failed_migration_recovery_reports_confirmation_truthfully(self):
        config = self.root / "compose.json"
        config.write_text('{}')
        for down_result, message in ((0, "Enabled for Quiz"), (2, "could not confirm")):
            trace = self.root / f"recovery-{down_result}"
            code = self.prefix + f'''
CANDIDATE_CONFIG={shlex.quote(str(config))}; MIGRATION_STARTED=1
compose() {{ printf '%s\\n' "$*" >> {shlex.quote(str(trace))}; if [[ $* == *'artisan down' ]]; then return {down_result}; fi; }}
run 'Migration fixture' bash -c 'exit 19'
'''
            result = shell(code)
            self.assertEqual(result.returncode, 19, result.stderr)
            self.assertIn(message, result.stdout)
            self.assertIn("No automatic database rollback", result.stdout)
            self.assertIn("artisan down", trace.read_text())
            self.assertIn("stop worker", trace.read_text())
            self.assertNotIn("migrate:rollback", trace.read_text())

    def test_interrupted_task_keeps_signal_status_and_terminates_only_its_child(self):
        child_file = self.root / "child.pid"
        code = self.prefix + f"slow_task() {{ bash -c 'echo $$ > \"$1\"; exec sleep 30' fixture {shlex.quote(str(child_file))}; }}; run 'Interrupted fixture' slow_task"
        command = f"set -Eeuo pipefail; source {shlex.quote(str(SCRIPT))}; UI_PLAIN=1; UI_STARTED=$SECONDS; STAGE=0; ui_init; " + code
        decoy = subprocess.Popen(["sleep", "10"])
        process = subprocess.Popen(["bash", "-c", command], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 5
            while not child_file.exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(child_file.exists())
            child_pid = int(child_file.read_text())
            process.send_signal(signal.SIGTERM)
            output, error = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 143, error)
            self.assertIn("Exit status: 143", output)
            self.assertIsNone(decoy.poll(), "An unrelated fixture process was stopped")
            state = Path(f"/proc/{child_pid}/stat")
            deadline = time.monotonic() + 2
            while state.exists() and state.read_text().split()[2] != "Z" and time.monotonic() < deadline:
                time.sleep(.01)
            if state.exists():
                self.assertEqual(state.read_text().split()[2], "Z")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            decoy.terminate()
            decoy.wait()

    def test_failed_backup_preserves_status_and_does_not_claim_completion(self):
        result = shell(self.prefix + "MODE=backup; compose() { return 27; }; backup_quiz fixture")
        self.assertEqual(result.returncode, 27, result.stderr)
        self.assertIn("BACKUP STOPPED", result.stdout)
        self.assertNotIn("Database + media / complete", result.stdout)

    def test_readiness_progress_does_not_print_http_response_bodies(self):
        result = shell(self.prefix + f"RUN_DIR={shlex.quote(str(self.root))}; " + r"""
curl() { printf 'SAFE_TOKEN' > "$RUN_DIR/http-response"; printf '200'; }
wait_http 'Fixture HTTP' 'http://fixture.invalid/' SAFE_TOKEN 1
""")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Fixture HTTP / ready in", result.stdout)
        self.assertNotIn("SAFE_TOKEN", result.stdout)

    def test_status_renders_only_safe_container_fields(self):
        for data in ([{"Service": "api", "State": "running", "Health": "healthy", "Command": "HIDDEN_STATUS_SECRET"}],
                     {"Service": "gateway", "State": "running", "Publishers": [{"URL": "127.0.0.1", "PublishedPort": 18080}]},
                     '{"Service":"api","State":"running"}\n{"Service":"worker","State":"running"}'):
            encoded = data if isinstance(data, str) else json.dumps(data)
            result = shell(self.prefix + f"OLD_CONFIG=fixture; compose() {{ printf '%s' {shlex.quote(encoded)}; }}; systemctl() {{ return 1; }}; ui_status")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("HIDDEN_STATUS_SECRET", result.stdout)
            self.assertIn("QUIZ SERVICES", result.stdout)


class PreflightTests(unittest.TestCase):
    def test_check_remains_read_only_with_stubbed_infrastructure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "runtime"
            copy = Path(temp) / "deployer.sh"
            text = SCRIPT.read_text().replace('ROOT=/opt/webostics-quiz', 'ROOT=' + shlex.quote(str(root)))
            text = text.replace("  ((EUID == 0)) || fail 'Run with sudo or as root. Use --help for commands.'", "  : # Privilege check bypassed only in this disposable fixture.")
            copy.write_text(text)
            harness = f'''set -Eeuo pipefail
source {shlex.quote(str(copy))}
require_ubuntu() {{ message OK 'Fixture Ubuntu'; }}
check_resources() {{ message INFO 'Fixture resource capacity'; }}
check_checkout() {{ :; }}
check_ports_and_nginx() {{ message OK 'Fixture Nginx'; }}
check_docker_ownership() {{ :; }}
check_local_docker() {{ :; }}
select_port() {{ PORT=18080; }}
docker() {{
  case "$*" in info) return 0 ;; 'compose version') printf 'Docker Compose fixture\\n' ;; 'buildx version') printf 'Buildx fixture\\n' ;; *) return 93 ;; esac
}}
main --check --plain
'''
            result = subprocess.run(["bash", "-c", harness], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("PREFLIGHT COMPLETE", result.stdout)
            self.assertFalse(root.exists(), "Read-only preflight created runtime data")


if __name__ == "__main__":
    unittest.main(verbosity=2)

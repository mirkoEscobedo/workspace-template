#![cfg(windows)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, TerminateProcess, WaitForSingleObject,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("workspace-template-owned-git-{nonce}"));
        fs::create_dir_all(root.join(".agentic")).unwrap();
        fs::write(root.join("package.json"), r#"{"name":"fixture"}"#).unwrap();
        fs::write(root.join("source.txt"), "before\n").unwrap();
        fs::write(
            root.join(".agentic/project.json"),
            serde_json::to_vec(&json!({
                "overrides":{"workspace":{"commands":{"node:.":[{
                    "program":"cmd.exe", "args":["/D", "/C", "exit 0"], "cwd":"."
                }]}}}
            }))
            .unwrap(),
        )
        .unwrap();
        git(&root, &["init", "-q"]);
        git(&root, &["config", "user.name", "Test"]);
        git(&root, &["config", "user.email", "test@example.invalid"]);
        git(&root, &["add", "."]);
        git(&root, &["commit", "-qm", "fixture"]);
        fs::create_dir(root.join(".git/descendants")).unwrap();
        let markers = serde_json::to_string(&root.join(".git/descendants")).unwrap();
        fs::write(root.join(".git/fsmonitor.cjs"), format!(
            "const {{spawn}} = require('node:child_process');\nconst {{writeFileSync, existsSync, renameSync}} = require('node:fs');\nconst {{join}} = require('node:path');\nconst dir = {markers};\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {{}}, 1000); setTimeout(() => process.exit(0), 30000)'], {{detached:true, stdio:'ignore'}});\nchild.unref();\nwriteFileSync(join(dir, child.pid + '.tmp'), String(child.pid));\nrenameSync(join(dir, child.pid + '.tmp'), join(dir, child.pid + '.pid'));\nconst until = Date.now() + 4000;\nconst wait = setInterval(() => {{\n  if (existsSync(join(dir, child.pid + '.ack')) || Date.now() > until) {{\n    clearInterval(wait);\n    process.stdout.write(Buffer.from('fixture-token\\0/\\0'));\n  }}\n}}, 10);\n"
        )).unwrap();
        let helper = root
            .join(".git/fsmonitor.cjs")
            .to_string_lossy()
            .replace('\\', "/")
            .replace('\'', "'\\''");
        fs::write(
            root.join(".git/hooks/fsmonitor"),
            format!("#!/bin/sh\nexec node '{helper}' \"$@\"\n"),
        )
        .unwrap();
        git(&root, &["config", "core.fsmonitor", ".git/hooks/fsmonitor"]);
        git(&root, &["config", "core.fsmonitorHookVersion", "2"]);
        fs::write(root.join("source.txt"), "changed\n").unwrap();
        Self(root)
    }

    fn public(&self, args: &[&str]) -> (Output, Vec<TrackedProcess>) {
        let mut command = Command::new(env!("CARGO_BIN_EXE_workspace-template"));
        command
            .arg(args[0])
            .arg(&self.0)
            .args(&args[1..])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut cli = OwnedCli(Some(command.spawn().unwrap()));
        let mut seen = BTreeSet::new();
        let mut descendants = Vec::new();
        let started = Instant::now();
        loop {
            for entry in fs::read_dir(self.0.join(".git/descendants"))
                .unwrap()
                .flatten()
            {
                let path = entry.path();
                if path.extension().and_then(|extension| extension.to_str()) != Some("pid")
                    || !seen.insert(path.clone())
                {
                    continue;
                }
                let pid = fs::read_to_string(&path).unwrap().parse::<u32>().unwrap();
                let handle = unsafe {
                    OpenProcess(
                        PROCESS_SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                        0,
                        pid,
                    )
                };
                assert!(
                    !handle.is_null(),
                    "unable to retain exact fixture descendant {pid}"
                );
                descendants.push(TrackedProcess { handle, pid });
                fs::write(path.with_extension("ack"), "retained\n").unwrap();
            }
            if cli.0.as_mut().unwrap().try_wait().unwrap().is_some() {
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "public command failed to finish"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        let output = cli.0.take().unwrap().wait_with_output().unwrap();
        assert!(
            !descendants.is_empty(),
            "Git did not invoke the fsmonitor control"
        );
        (output, descendants)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

struct OwnedCli(Option<Child>);

impl Drop for OwnedCli {
    fn drop(&mut self) {
        if let Some(child) = &mut self.0 {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

struct TrackedProcess {
    handle: HANDLE,
    pid: u32,
}

impl Drop for TrackedProcess {
    fn drop(&mut self) {
        if unsafe { WaitForSingleObject(self.handle, 0) } != WAIT_OBJECT_0 {
            unsafe {
                TerminateProcess(self.handle, 1);
                WaitForSingleObject(self.handle, 5000);
            }
        }
        unsafe { CloseHandle(self.handle) };
    }
}

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn assert_descendants_dead(descendants: &[TrackedProcess]) {
    for descendant in descendants {
        let immediate = unsafe { WaitForSingleObject(descendant.handle, 0) };
        let mut exit_code = 0;
        let queried = unsafe { GetExitCodeProcess(descendant.handle, &mut exit_code) };
        let later = if immediate != WAIT_OBJECT_0 {
            unsafe { WaitForSingleObject(descendant.handle, 1000) }
        } else {
            immediate
        };
        assert_eq!(
            immediate,
            WAIT_OBJECT_0,
            "fsmonitor descendant {} survived the final public report (exit query: {queried}, initial exit code: {exit_code}, signal within 1000 ms: {later})",
            descendant.pid,
        );
    }
}

#[test]
fn inspect_finishes_only_after_owned_git_fsmonitor_descendants_exit() {
    let fixture = Fixture::new();
    let (output, descendants) = fixture.public(&["inspect"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["result"]["workspace"]["valid"], true);
    assert_eq!(envelope["result"]["workspace"]["git"]["dirty"], true);
    assert_descendants_dead(&descendants);
}

#[test]
fn all_scope_verification_finishes_after_git_discovery_descendants_exit() {
    let fixture = Fixture::new();
    let (output, descendants) = fixture.public(&["verify", "--scope", "all", "--timeout", "1000"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["result"]["verdict"], "PASS");
    assert_eq!(envelope["result"]["steps"][0]["cleanup"]["qualified"], true);
    assert_descendants_dead(&descendants);
}

#[test]
fn affected_selection_finishes_after_each_git_fsmonitor_descendant_exits() {
    let fixture = Fixture::new();
    let (output, descendants) =
        fixture.public(&["verify", "--scope", "affected", "--timeout", "1000"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["result"]["verdict"], "PASS");
    assert_eq!(
        envelope["result"]["selection"]["modules"],
        json!(["node:."])
    );
    assert!(
        descendants.len() >= 2,
        "affected selection did not exercise Git beyond graph discovery"
    );
    assert_descendants_dead(&descendants);
}

#[test]
fn failed_git_launch_makes_graph_discovery_unqualified() {
    let fixture = Fixture::new();
    let output = Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(["inspect", fixture.0.to_str().unwrap()])
        .env("PATH", &fixture.0)
        .output()
        .unwrap();
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    let graph = &envelope["result"]["workspace"];
    assert_eq!(graph["valid"], false);
    assert_eq!(graph["git"], json!({"head":null, "dirty":null}));
    assert!(graph["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|conflict| conflict["code"] == "GIT_DISCOVERY_UNQUALIFIED"
            && conflict["message"].as_str().unwrap().contains("launch git")));
}

#[test]
fn qualified_git_nonzero_in_a_nonrepository_preserves_unknown_git_state() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.0.join("outside")).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(["inspect", fixture.0.join("outside").to_str().unwrap()])
        .env("GIT_CEILING_DIRECTORIES", &fixture.0)
        .output()
        .unwrap();
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["result"]["workspace"]["valid"], true);
    assert_eq!(
        envelope["result"]["workspace"]["git"],
        json!({"head":null, "dirty":null})
    );
}

#[test]
fn git_discovery_timeout_blocks_verification_and_removes_owned_descendants() {
    let fixture = Fixture::new();
    let helper = fixture.0.join(".git/fsmonitor.cjs");
    let script = fs::read_to_string(&helper).unwrap().replace(
        "process.stdout.write(Buffer.from('fixture-token\\0/\\0'));",
        "setInterval(() => {}, 1000);",
    );
    fs::write(helper, script).unwrap();
    let (output, descendants) = fixture.public(&["verify", "--scope", "all", "--timeout", "1000"]);
    assert!(!output.status.success());
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["result"]["verdict"], "INSUFFICIENT_EVIDENCE");
    assert_eq!(envelope["result"]["steps"], json!([]));
    assert!(envelope["result"]["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|conflict| conflict["code"] == "GIT_DISCOVERY_UNQUALIFIED"
            && conflict["message"]
                .as_str()
                .unwrap()
                .contains("exceeded 5000 ms")));
    assert_descendants_dead(&descendants);
}

#[test]
fn affected_git_timeout_blocks_selection_and_removes_owned_descendants() {
    let fixture = Fixture::new();
    let helper = fixture.0.join(".git/fsmonitor.cjs");
    let script = fs::read_to_string(&helper).unwrap()
        .replace("writeFileSync, existsSync", "writeFileSync, existsSync, readFileSync")
        .replace("const until =", "const calls = join(dir, 'calls');\nconst call = existsSync(calls) ? Number(readFileSync(calls, 'utf8')) + 1 : 1;\nwriteFileSync(calls, String(call));\nconst until =")
        .replace("process.stdout.write(Buffer.from('fixture-token\\0/\\0'));", "if (call === 1) process.stdout.write(Buffer.from('fixture-token\\0/\\0')); else setInterval(() => {}, 1000);");
    fs::write(helper, script).unwrap();
    let (output, descendants) =
        fixture.public(&["verify", "--scope", "affected", "--timeout", "1000"]);
    assert!(!output.status.success());
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["result"]["verdict"], "INSUFFICIENT_EVIDENCE");
    assert_eq!(envelope["result"]["steps"], json!([]));
    assert!(envelope["result"]["errors"]
        .as_array()
        .unwrap()
        .iter()
        .any(|error| error
            .as_str()
            .unwrap()
            .contains("Git discovery diff --name-only exceeded 5000 ms")));
    assert!(descendants.len() >= 2);
    assert_descendants_dead(&descendants);
}

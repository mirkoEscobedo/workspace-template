#![cfg(windows)]

use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use windows_sys::Win32::Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, WAIT_OBJECT_0};
use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT};
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, CREATE_NEW_PROCESS_GROUP, PROCESS_SYNCHRONIZE,
};

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str, root_behavior: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("workspace-template-cleanup-{name}-{nonce}"));
        fs::create_dir_all(root.join("packages/check")).unwrap();
        fs::create_dir_all(root.join(".agentic")).unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"private":true,"workspaces":["packages/*"]}"#,
        )
        .unwrap();
        fs::write(
            root.join("packages/check/package.json"),
            r#"{"name":"check"}"#,
        )
        .unwrap();
        fs::write(root.join("packages/check/command.js"), format!(
            "const {{spawn}} = require('node:child_process');\nconst {{writeFileSync}} = require('node:fs');\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {{}}, 1000)'], {{detached:true, stdio:'ignore'}});\nwriteFileSync('descendant.json', JSON.stringify({{pid:child.pid}}));\nchild.unref();\n{root_behavior}\n"
        )).unwrap();
        fs::write(
            root.join(".agentic/project.json"),
            serde_json::to_vec(&json!({
                "overrides":{"workspace":{"commands":{"node:packages/check":[{
                    "program":"node.exe", "args":["command.js"], "cwd":"packages/check"
                }]}}}
            }))
            .unwrap(),
        )
        .unwrap();
        Self(root)
    }

    fn command(&self, timeout_ms: u64) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_workspace-template"));
        command.args([
            "verify",
            self.0.to_str().unwrap(),
            "--scope",
            "all",
            "--timeout",
            &timeout_ms.to_string(),
        ]);
        command
    }

    fn run(&self, timeout_ms: u64) -> Output {
        self.command(timeout_ms)
            .output()
            .expect("public CLI must launch")
    }

    fn descendant(&self) -> u32 {
        serde_json::from_slice::<Value>(
            &fs::read(self.0.join("packages/check/descendant.json")).unwrap(),
        )
        .unwrap()["pid"]
            .as_u64()
            .unwrap() as u32
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

struct Unrelated(Child);

impl Unrelated {
    fn new() -> Self {
        Self(
            Command::new("node.exe")
                .args(["-e", "setInterval(() => {}, 1000)"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    }
}

impl Drop for Unrelated {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn assert_gone(pid: u32, root: &Path) {
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(ERROR_INVALID_PARAMETER as i32),
            "unable to establish absence of owned descendant {pid}"
        );
    } else {
        let wait =
            unsafe { WaitForSingleObject(handle, Duration::from_secs(5).as_millis() as u32) };
        unsafe { CloseHandle(handle) };
        assert_eq!(
            wait,
            WAIT_OBJECT_0,
            "owned descendant {pid} survived in {}",
            root.display()
        );
    }
}

#[test]
fn nonzero_command_observes_zero_owned_descendants_and_remains_failed() {
    let fixture = Fixture::new("nonzero", "process.exit(7);");
    let output = fixture.run(5000);
    assert!(!output.status.success());
    let result = assert_cleanup(&output, &fixture);
    assert_eq!(result["result"]["verdict"], "FAIL");
    assert_eq!(result["result"]["steps"][0]["status"], 7);
    assert_eq!(result["result"]["steps"][0]["timedOut"], false);
}

#[test]
fn timed_out_command_observes_zero_owned_descendants_and_remains_failed() {
    let fixture = Fixture::new("timeout", "setInterval(() => {}, 1000);");
    let output = fixture.run(1000);
    assert!(!output.status.success());
    let result = assert_cleanup(&output, &fixture);
    assert_eq!(result["result"]["verdict"], "FAIL");
    assert_eq!(result["result"]["steps"][0]["timedOut"], true);
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

fn interrupted_command(mode: &str) {
    let fixture = Fixture::new(mode, "setInterval(() => {}, 1000);");
    let mut command = fixture.command(30000);
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NEW_PROCESS_GROUP);
    let mut owned = OwnedCli(Some(command.spawn().unwrap()));
    let started = Instant::now();
    while !fixture.0.join("packages/check/descendant.json").is_file()
        && started.elapsed() < Duration::from_secs(5)
    {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        fixture.0.join("packages/check/descendant.json").is_file(),
        "verification descendant never started"
    );
    let child = owned.0.as_mut().unwrap();
    match mode {
        "cancel" => assert_ne!(
            unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, child.id()) },
            0,
            "failed to deliver cancellation to owned CLI"
        ),
        "hard-death" => child.kill().unwrap(),
        _ => unreachable!(),
    }
    let started = Instant::now();
    while child.try_wait().unwrap().is_none() {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "CLI did not terminate after {mode}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = owned.0.take().unwrap().wait_with_output().unwrap();
    assert!(!output.status.success());
    assert!(
        output.stdout.is_empty(),
        "interrupted CLI invented a final verification report"
    );
    assert_gone(fixture.descendant(), &fixture.0);
}

#[test]
fn cancellation_preserves_kill_on_close_without_inventing_a_final_report() {
    interrupted_command("cancel");
}

#[test]
fn abrupt_cli_death_preserves_kill_on_close_without_inventing_a_final_report() {
    interrupted_command("hard-death");
}

fn assert_cleanup(output: &Output, fixture: &Fixture) -> Value {
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap();
    let step = &envelope["result"]["steps"][0];
    assert_eq!(step["processOwnership"], "windows-job-object");
    assert_eq!(step["cleanup"]["qualified"], true, "{envelope}");
    assert_eq!(step["cleanup"]["outcome"], "zero-active-processes");
    assert_eq!(step["cleanup"]["activeProcesses"], 0);
    let retained = step["cleanup"]["retainedProcesses"].as_u64().unwrap();
    assert!(
        retained > 0,
        "detached descendant was not retained at the terminal cut"
    );
    assert_eq!(
        step["cleanup"]["signaledProcesses"].as_u64(),
        Some(retained)
    );
    assert!(step["cleanup"]["durationMs"].is_u64());
    assert!(step["cleanup"]["error"].is_null());
    assert_gone(fixture.descendant(), &fixture.0);
    envelope
}

#[test]
fn successful_command_observes_zero_owned_descendants_and_preserves_unrelated_process() {
    let fixture = Fixture::new("success", "process.exit(0);");
    let mut unrelated = Unrelated::new();
    let output = fixture.run(5000);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let result = assert_cleanup(&output, &fixture);
    assert_eq!(result["result"]["verdict"], "PASS");
    assert!(
        unrelated.0.try_wait().unwrap().is_none(),
        "unrelated process was terminated"
    );
}

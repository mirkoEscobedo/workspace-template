use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub struct RunResult {
    pub status: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
}

fn drain<R: Read + Send + 'static>(mut reader: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut retained = Vec::new();
        let mut chunk = [0_u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    retained.extend_from_slice(&chunk[..count]);
                    if retained.len() > 100_000 {
                        retained.drain(..retained.len() - 100_000);
                    }
                }
            }
        }
        String::from_utf8_lossy(&retained).into_owned()
    })
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
    };

    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    fn job() -> Result<OwnedHandle, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "CreateJobObjectW failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let owned = OwnedHandle(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            return Err(format!(
                "SetInformationJobObject failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(owned)
    }

    fn resume_process_threads(pid: u32) -> Result<(), String> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(format!(
                "thread snapshot failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let snapshot = OwnedHandle(snapshot);
        let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
        entry.dwSize = size_of::<THREADENTRY32>() as u32;
        let mut found = false;
        let mut has_entry = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
        while has_entry {
            if entry.th32OwnerProcessID == pid {
                let thread_handle =
                    unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if !thread_handle.is_null() {
                    let thread_handle = OwnedHandle(thread_handle);
                    let resumed = unsafe { ResumeThread(thread_handle.0) };
                    if resumed != u32::MAX {
                        found = true;
                    }
                }
            }
            has_entry = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
        }
        if found {
            Ok(())
        } else {
            Err("suspended process thread could not be resumed".to_owned())
        }
    }

    pub fn run(
        command: &str,
        args: &[String],
        cwd: &Path,
        timeout: Duration,
    ) -> Result<RunResult, String> {
        let owned_job = job()?;
        let mut process = Command::new(command);
        process
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
        let mut child = process
            .spawn()
            .map_err(|error| format!("launch {command}: {error}"))?;
        let assigned =
            unsafe { AssignProcessToJobObject(owned_job.0, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "AssignProcessToJobObject failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        if let Err(error) = resume_process_threads(child.id()) {
            unsafe { TerminateJobObject(owned_job.0, 125) };
            let _ = child.wait();
            return Err(error);
        }
        let stdout = drain(child.stdout.take().expect("captured stdout"));
        let stderr = drain(child.stderr.take().expect("captured stderr"));
        let started = Instant::now();
        let (status, timed_out) = loop {
            match child
                .try_wait()
                .map_err(|error| format!("wait for {command}: {error}"))?
            {
                Some(status) => break (status.code(), false),
                None if started.elapsed() >= timeout => {
                    unsafe { TerminateJobObject(owned_job.0, 124) };
                    let status = child
                        .wait()
                        .map_err(|error| format!("wait after timeout: {error}"))?;
                    break (status.code(), true);
                }
                None => thread::sleep(Duration::from_millis(10)),
            }
        };
        // The root may have exited while a descendant remained. Terminating the
        // job is the deterministic terminal cut for every admitted command.
        unsafe { TerminateJobObject(owned_job.0, status.unwrap_or(1) as u32) };
        drop(owned_job);
        Ok(RunResult {
            status,
            timed_out,
            stdout: stdout.join().unwrap_or_default(),
            stderr: stderr.join().unwrap_or_default(),
        })
    }
}

#[cfg(windows)]
pub use platform::run;

#[cfg(not(windows))]
pub fn run(
    _command: &str,
    _args: &[String],
    _cwd: &Path,
    _timeout: Duration,
) -> Result<RunResult, String> {
    Err("UNSUPPORTED_PLATFORM: this release supports Windows x64 only".to_owned())
}

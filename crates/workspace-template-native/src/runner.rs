use std::ffi::OsStr;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

mod cleanup;
pub use cleanup::CleanupObservation;

pub struct RunResult {
    pub status: Option<i32>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub cleanup: CleanupObservation,
    pub program_image: Option<String>,
}

#[cfg(windows)]
pub fn ownership() -> &'static str {
    "windows-job-object"
}

#[cfg(target_os = "linux")]
pub fn ownership() -> &'static str {
    "linux-process-group-experimental"
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn ownership() -> &'static str {
    "unsupported-platform"
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
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenThread, QueryFullProcessImageNameW, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED,
        PROCESS_NAME_WIN32, THREAD_SUSPEND_RESUME,
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

    fn process_image(process: HANDLE) -> Option<String> {
        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        let queried = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                buffer.as_mut_ptr(),
                &mut length,
            )
        };
        if queried == 0 || length == 0 || length as usize > buffer.len() {
            return None;
        }
        String::from_utf16(&buffer[..length as usize]).ok()
    }

    pub fn run(
        command: &OsStr,
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
            .map_err(|error| format!("launch {}: {error}", command.to_string_lossy()))?;
        let assigned =
            unsafe { AssignProcessToJobObject(owned_job.0, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            let assignment_error = std::io::Error::last_os_error();
            let cleanup_started = Instant::now();
            let termination_error = child.kill().err();
            // This root is still suspended and never entered the owned job.
            // Observe only its handle; no descendant code has been admitted.
            let exit_observation = loop {
                match child.try_wait() {
                    Ok(Some(_)) => break "exited".to_owned(),
                    Err(error) => break format!("query-error: {error}"),
                    Ok(None) if cleanup_started.elapsed() >= Duration::from_secs(5) => {
                        break "exit-not-observed-within-5000-ms".to_owned();
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(10)),
                }
            };
            return Err(format!(
                "AssignProcessToJobObject failed: {assignment_error}; suspended root cleanup: {exit_observation}; termination error: {termination_error:?}"
            ));
        }
        // Observe the actual image on the admitted suspended process. A batch
        // entrypoint launches an interpreter, which has its own input identity.
        let program_image = process_image(child.as_raw_handle() as HANDLE);
        if let Err(error) = resume_process_threads(child.id()) {
            let cleanup = cleanup::terminate_and_observe(owned_job.0, 125);
            drop(owned_job);
            if cleanup.qualified {
                let _ = child.wait();
            } else {
                let _ = child.try_wait();
            }
            return Err(format!(
                "{error}; cleanup: {}",
                serde_json::to_string(&cleanup).expect("cleanup observation serializes")
            ));
        }
        let stdout = drain(child.stdout.take().expect("captured stdout"));
        let stderr = drain(child.stderr.take().expect("captured stderr"));
        let started = Instant::now();
        let (mut status, timed_out) = loop {
            match child
                .try_wait()
                .map_err(|error| format!("wait for {}: {error}", command.to_string_lossy()))?
            {
                Some(status) => break (status.code(), false),
                None if started.elapsed() >= timeout => {
                    break (None, true);
                }
                None => thread::sleep(Duration::from_millis(10)),
            }
        };
        // The root may have exited while a descendant remained. Terminating the
        // job is the deterministic terminal cut for every admitted command.
        let cleanup = cleanup::terminate_and_observe(
            owned_job.0,
            if timed_out {
                124
            } else {
                status.unwrap_or(1) as u32
            },
        );
        drop(owned_job);
        if timed_out {
            // A qualified job has no live root left to wait for. On cleanup
            // failure, preserve the observation and avoid an unbounded wait.
            status = if cleanup.qualified {
                child
                    .wait()
                    .map_err(|error| format!("wait after timeout: {error}"))?
                    .code()
            } else {
                child
                    .try_wait()
                    .ok()
                    .flatten()
                    .and_then(|status| status.code())
            };
        }
        let retain_output = |reader: thread::JoinHandle<String>| {
            if cleanup.qualified || reader.is_finished() {
                reader.join().unwrap_or_default()
            } else {
                // Closing the job retains kill-on-close on every failure path.
                // A failed observation must not block indefinitely on a pipe.
                String::new()
            }
        };
        Ok(RunResult {
            status,
            timed_out,
            stdout: retain_output(stdout),
            stderr: retain_output(stderr),
            cleanup,
            program_image,
        })
    }
}

#[cfg(windows)]
pub use platform::run;

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::os::unix::process::CommandExt;

    pub fn run(
        command: &OsStr,
        args: &[String],
        cwd: &Path,
        timeout: Duration,
    ) -> Result<RunResult, String> {
        let mut process = Command::new(command);
        process
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        unsafe {
            process.pre_exec(|| {
                if libc::setpgid(0, 0) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
        let mut child = process
            .spawn()
            .map_err(|error| format!("launch {}: {error}", command.to_string_lossy()))?;
        let program_image = std::fs::read_link(format!("/proc/{}/exe", child.id()))
            .ok()
            .and_then(|path| path.to_str().map(str::to_owned));
        let process_group = child.id() as i32;
        let stdout = drain(child.stdout.take().expect("captured stdout"));
        let stderr = drain(child.stderr.take().expect("captured stderr"));
        let started = Instant::now();
        let (status, timed_out) = loop {
            match child
                .try_wait()
                .map_err(|error| format!("wait for {}: {error}", command.to_string_lossy()))?
            {
                Some(status) => break (status.code(), false),
                None if started.elapsed() >= timeout => {
                    unsafe {
                        libc::kill(-process_group, libc::SIGKILL);
                    }
                    let status = child
                        .wait()
                        .map_err(|error| format!("wait after timeout: {error}"))?;
                    break (status.code(), true);
                }
                None => thread::sleep(Duration::from_millis(10)),
            }
        };
        unsafe {
            libc::kill(-process_group, libc::SIGKILL);
        }
        Ok(RunResult {
            status,
            timed_out,
            stdout: stdout.join().unwrap_or_default(),
            stderr: stderr.join().unwrap_or_default(),
            cleanup: cleanup::unqualified(),
            program_image,
        })
    }
}

#[cfg(target_os = "linux")]
pub use linux::run;

#[cfg(not(any(windows, target_os = "linux")))]
pub fn run(
    _command: &OsStr,
    _args: &[String],
    _cwd: &Path,
    _timeout: Duration,
) -> Result<RunResult, String> {
    Err("UNSUPPORTED_PLATFORM: no qualified process supervisor exists for this platform".to_owned())
}

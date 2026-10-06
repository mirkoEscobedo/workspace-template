use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupObservation {
    pub qualified: bool,
    pub outcome: &'static str,
    pub active_processes: Option<u32>,
    pub retained_processes: Option<u32>,
    pub signaled_processes: Option<u32>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[cfg(target_os = "linux")]
pub fn unqualified() -> CleanupObservation {
    CleanupObservation {
        qualified: false,
        outcome: "unqualified-platform",
        active_processes: None,
        retained_processes: None,
        signaled_processes: None,
        duration_ms: 0,
        error: Some("experimental process groups do not establish zero owned descendants".into()),
    }
}

#[cfg(windows)]
mod members;

#[cfg(windows)]
mod windows {
    use super::members::{self, Error, Members, Snapshot};
    use super::CleanupObservation;
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::TerminateJobObject;

    const CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);

    fn observe(
        job: HANDLE,
        termination_error: Option<String>,
        snapshot: Result<Snapshot, Error>,
        mut members: Members,
        started: Instant,
        timeout: Duration,
    ) -> CleanupObservation {
        let mut active_processes = None;
        let mut signaled_processes = None;
        let failure = loop {
            let accounting = match members::accounting(job) {
                Ok(accounting) => accounting,
                Err(error) => break Some(error),
            };
            active_processes = Some(accounting.active);
            if let Some(error) = &termination_error {
                break Some(("termination-error", error.clone()));
            }
            let snapshot = match &snapshot {
                Ok(snapshot) => snapshot,
                Err(error) => break Some(error.clone()),
            };
            if let Err(error) = members.retain(job, started, timeout) {
                break Some(error);
            }
            let accounting = match members::accounting(job) {
                Ok(accounting) => accounting,
                Err(error) => break Some(error),
            };
            active_processes = Some(accounting.active);
            let signaled = match members.signaled(started, timeout) {
                Ok(signaled) => signaled,
                Err(error) => break Some(error),
            };
            signaled_processes = Some(signaled);
            if started.elapsed() >= timeout {
                break Some(("cleanup-timeout", format!("owned job did not establish zero active processes and signaled retained handles within {} ms", timeout.as_millis())));
            }
            if accounting.active == 0 {
                if accounting.total.checked_sub(snapshot.total)
                    != Some(members.count() - snapshot.retained)
                {
                    break Some(("admission-gap", "new owned job admissions could not all be retained across the terminal cut".into()));
                }
                if signaled == members.count() {
                    break None;
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let failure = match (&termination_error, failure) {
            (Some(termination_error), Some((outcome, error))) if outcome != "termination-error" => {
                Some(("termination-error", format!("{termination_error}; {error}")))
            }
            (_, failure) => failure,
        };
        let (outcome, error) = failure
            .map_or(("zero-active-processes", None), |(outcome, error)| {
                (outcome, Some(error))
            });
        CleanupObservation {
            qualified: outcome == "zero-active-processes",
            outcome,
            active_processes,
            retained_processes: Some(members.count()),
            signaled_processes,
            duration_ms: started.elapsed().as_millis() as u64,
            error,
        }
    }

    pub fn terminate_and_observe(job: HANDLE, exit_code: u32) -> CleanupObservation {
        let started = Instant::now();
        let mut members = Members::default();
        let snapshot = members.prepare(job, started, CLEANUP_TIMEOUT);
        let terminated = unsafe { TerminateJobObject(job, exit_code) };
        let error = (terminated == 0).then(|| {
            format!(
                "TerminateJobObject failed: {}",
                std::io::Error::last_os_error()
            )
        });
        // Windows accounting zero can precede terminal process-handle signaling.
        // Keep the actual job and retained member handles until both are observed.
        observe(job, error, snapshot, members, started, CLEANUP_TIMEOUT)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::mem::size_of;
        use std::os::windows::io::{FromRawHandle, OwnedHandle};
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

        #[test]
        fn failed_job_query_cannot_qualify_cleanup_or_invent_zero() {
            let result = observe(
                INVALID_HANDLE_VALUE,
                None,
                Ok(Snapshot {
                    total: 0,
                    retained: 0,
                }),
                Members::default(),
                Instant::now(),
                CLEANUP_TIMEOUT,
            );
            assert!(!result.qualified);
            assert_eq!(result.outcome, "query-error");
            assert_eq!(result.active_processes, None);
            assert!(result.error.unwrap().contains("QueryInformationJobObject"));
        }

        #[test]
        fn failed_job_termination_is_reported_without_qualification() {
            let result = terminate_and_observe(INVALID_HANDLE_VALUE, 1);
            assert!(!result.qualified);
            assert_eq!(result.outcome, "termination-error");
            assert_eq!(result.active_processes, None);
            assert!(result.error.unwrap().contains("TerminateJobObject"));
        }

        #[test]
        fn an_active_owned_job_reaches_a_bounded_unqualified_observation() {
            use std::os::windows::io::AsRawHandle;

            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            assert!(!job.is_null());
            let owned_job = unsafe { OwnedHandle::from_raw_handle(job) };
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            assert_ne!(
                unsafe {
                    SetInformationJobObject(
                        job,
                        JobObjectExtendedLimitInformation,
                        &limits as *const _ as *const _,
                        size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    )
                },
                0
            );
            let mut child = Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Start-Sleep -Seconds 30",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .unwrap();
            if unsafe { AssignProcessToJobObject(job, child.as_raw_handle()) } == 0 {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("fixture command could not enter the test-owned job");
            }
            let started = Instant::now();
            let mut members = Members::default();
            let snapshot = members.prepare(job, started, Duration::from_millis(50));
            let result = observe(
                job,
                None,
                snapshot,
                members,
                started,
                Duration::from_millis(50),
            );
            let terminal = terminate_and_observe(job, 1);
            let gap = observe(
                job,
                None,
                Ok(Snapshot {
                    total: 0,
                    retained: 0,
                }),
                Members::default(),
                Instant::now(),
                CLEANUP_TIMEOUT,
            );
            child.wait().unwrap();
            drop(owned_job);
            assert!(!result.qualified);
            assert_eq!(result.outcome, "cleanup-timeout");
            assert!(result.active_processes.unwrap() > 0);
            assert!(result.duration_ms >= 50);
            assert!(result.duration_ms < 5000);
            assert!(result.error.unwrap().contains("50 ms"));
            assert!(
                terminal.qualified,
                "test owner did not reach zero: {terminal:?}"
            );
            assert!(!gap.qualified);
            assert_eq!(gap.outcome, "admission-gap");
            assert_eq!(gap.active_processes, Some(0));
        }
    }
}

#[cfg(windows)]
pub use windows::terminate_and_observe;

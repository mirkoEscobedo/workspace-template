use std::collections::BTreeMap;
use std::mem::{offset_of, size_of};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::JobObjects::{
    IsProcessInJob, JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
    QueryInformationJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_BASIC_PROCESS_ID_LIST,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};

const MAX_MEMBERS: usize = 4096;
pub type Error = (&'static str, String);

pub struct Accounting {
    pub active: u32,
    pub total: u32,
}

pub struct Snapshot {
    pub total: u32,
    pub retained: u32,
}

fn within_deadline(started: Instant, timeout: Duration) -> Result<(), Error> {
    if started.elapsed() >= timeout {
        Err((
            "cleanup-timeout",
            format!(
                "owned process observation exceeded the {} ms cleanup deadline",
                timeout.as_millis()
            ),
        ))
    } else {
        Ok(())
    }
}

pub fn accounting(job: HANDLE) -> Result<Accounting, Error> {
    let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            &mut info as *mut _ as *mut _,
            size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err((
            "query-error",
            format!(
                "QueryInformationJobObject accounting failed: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    Ok(Accounting {
        active: info.ActiveProcesses,
        total: info.TotalProcesses,
    })
}

#[derive(Default)]
pub struct Members {
    handles: BTreeMap<u32, OwnedHandle>,
}

impl Members {
    pub fn count(&self) -> u32 {
        self.handles.len() as u32
    }

    pub fn retain(
        &mut self,
        job: HANDLE,
        started: Instant,
        timeout: Duration,
    ) -> Result<(), Error> {
        within_deadline(started, timeout)?;
        // usize storage keeps the native variable-length structure aligned.
        let offset = offset_of!(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList);
        let bytes = offset + MAX_MEMBERS * size_of::<usize>();
        let mut buffer = vec![0_usize; bytes.div_ceil(size_of::<usize>())];
        if unsafe {
            QueryInformationJobObject(
                job,
                JobObjectBasicProcessIdList,
                buffer.as_mut_ptr() as *mut _,
                bytes as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err((
                "retention-error",
                format!(
                    "QueryInformationJobObject member list failed (limit {MAX_MEMBERS}): {}",
                    std::io::Error::last_os_error()
                ),
            ));
        }
        let list = unsafe { &*(buffer.as_ptr() as *const JOBOBJECT_BASIC_PROCESS_ID_LIST) };
        if list.NumberOfAssignedProcesses > MAX_MEMBERS as u32
            || list.NumberOfProcessIdsInList != list.NumberOfAssignedProcesses
        {
            return Err((
                "retention-error",
                "owned job member list exceeds the bounded complete-list limit".into(),
            ));
        }
        let pids = unsafe {
            std::slice::from_raw_parts(
                buffer.as_ptr().cast::<u8>().add(offset).cast::<usize>(),
                list.NumberOfProcessIdsInList as usize,
            )
        };
        for &pid in pids {
            within_deadline(started, timeout)?;
            let pid = u32::try_from(pid).map_err(|_| {
                (
                    "retention-error",
                    "owned job returned an invalid process identifier".into(),
                )
            })?;
            if self.handles.contains_key(&pid) {
                continue;
            }
            if self.handles.len() == MAX_MEMBERS {
                return Err((
                    "retention-error",
                    "owned process retention exceeded 4096 handles".into(),
                ));
            }
            let handle = unsafe {
                OpenProcess(
                    PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid,
                )
            };
            if handle.is_null() {
                return Err((
                    "retention-error",
                    format!(
                        "OpenProcess for owned job member {pid} failed: {}",
                        std::io::Error::last_os_error()
                    ),
                ));
            }
            let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
            let mut in_job = 0;
            if unsafe { IsProcessInJob(handle.as_raw_handle(), job, &mut in_job) } == 0 {
                return Err((
                    "membership-error",
                    format!(
                        "IsProcessInJob for retained member {pid} failed: {}",
                        std::io::Error::last_os_error()
                    ),
                ));
            }
            if in_job == 0 {
                return Err((
                    "membership-error",
                    format!(
                        "retained process {pid} could not be confirmed in the actual owned job"
                    ),
                ));
            }
            self.handles.insert(pid, handle);
        }
        Ok(())
    }

    pub fn prepare(
        &mut self,
        job: HANDLE,
        started: Instant,
        timeout: Duration,
    ) -> Result<Snapshot, Error> {
        loop {
            within_deadline(started, timeout)?;
            let before = accounting(job)?;
            self.retain(job, started, timeout)?;
            let after = accounting(job)?;
            within_deadline(started, timeout)?;
            if before.total == after.total {
                return Ok(Snapshot {
                    total: after.total,
                    retained: self.count(),
                });
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn signaled(&self, started: Instant, timeout: Duration) -> Result<u32, Error> {
        within_deadline(started, timeout)?;
        let mut count = 0;
        for (&pid, handle) in &self.handles {
            within_deadline(started, timeout)?;
            match unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) } {
                WAIT_OBJECT_0 => count += 1,
                WAIT_TIMEOUT => (),
                _ => {
                    return Err((
                        "wait-error",
                        format!(
                            "WaitForSingleObject for owned member {pid} failed: {}",
                            std::io::Error::last_os_error()
                        ),
                    ))
                }
            }
        }
        Ok(count)
    }
}

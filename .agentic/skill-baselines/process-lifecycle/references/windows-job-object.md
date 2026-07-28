# Windows hardening

For production use on Windows, create a Job Object, set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, create the child suspended, assign it to the job, then resume it. Apply process-count, memory, and CPU limits where appropriate. `taskkill /T /F` is only a fallback when the harness did not own a Job Object from creation.

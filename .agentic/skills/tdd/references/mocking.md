# Mocking boundaries

Mock only boundaries whose real use is unavailable, unsafe, costly, nondeterministic, or outside the process: external APIs, time, randomness, operating-system effects, and occasionally databases/filesystems.

Do not mock your own domain modules to prove their collaboration. Prefer dependency injection and narrow boundary interfaces.

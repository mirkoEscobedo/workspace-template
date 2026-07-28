# D002 — Run-scoped refusal transition

Status: Superseded by [D007](D007-ultima-runtime-ownership.md).

## Historical record

D002 formerly described a workspace-template runtime transition after a Codex
child-model refusal. That route was never implemented or activated.

## Current decision

Ultima owns refusal detection, run-scoped state, route selection, and recovery.
workspace-template retains only the declarative fallback requirement completed
by FBK-001.

This record grants no implementation authority.

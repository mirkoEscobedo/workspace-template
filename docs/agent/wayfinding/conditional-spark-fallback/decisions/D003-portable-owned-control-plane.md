# D003 — Portable owned control plane

Status: Superseded by [D007](D007-ultima-runtime-ownership.md).

## Historical record

D003 formerly assigned a portable fallback control plane and its process
ownership to workspace-template. FBK-002 work toward that design remained
uncommitted and was removed.

## Current decision

Ultima owns the runtime control plane, process-tree containment, runtime leases,
and orchestration state. workspace-template may validate a declarative external
runtime requirement but does not ship this control plane.

This record grants no implementation authority.

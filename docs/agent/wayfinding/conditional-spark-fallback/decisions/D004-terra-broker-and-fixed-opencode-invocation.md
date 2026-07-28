# D004 — Terra broker and fixed OpenCode invocation

Status: Superseded by [D007](D007-ultima-runtime-ownership.md).

## Historical record

D004 formerly described a workspace-template runtime broker and fixed OpenCode
invocation path. No such runtime adapter was implemented in the track.

## Current decision

Ultima owns broker execution, OpenCode spawning, runtime permissions, and
transport behavior. The broker-shaped configuration retained from FBK-001 is a
declarative integration requirement only.

This record grants no implementation authority.

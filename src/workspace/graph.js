export function normalizeGraph(modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  for (const module of modules) {
    module.dependencies = [...new Set((module.dependencies ?? []).filter((id) => id !== module.id && byId.has(id)))].sort();
  }
  return [...modules].sort((left, right) => left.id.localeCompare(right.id));
}

export function graphCycles(modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  const stack = [];

  function visit(id) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) visit(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const module of modules) visit(module.id);
  return cycles;
}

export function topologicalLevels(modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const indegree = new Map(modules.map((module) => [module.id, 0]));
  const dependents = new Map(modules.map((module) => [module.id, []]));
  for (const module of modules) {
    for (const dependency of module.dependencies ?? []) {
      if (!byId.has(dependency)) continue;
      indegree.set(module.id, (indegree.get(module.id) ?? 0) + 1);
      dependents.get(dependency).push(module.id);
    }
  }
  const levels = [];
  let ready = [...modules.filter((module) => indegree.get(module.id) === 0).map((module) => module.id)].sort();
  const seen = new Set();
  while (ready.length > 0) {
    levels.push(ready);
    const next = [];
    for (const id of ready) {
      seen.add(id);
      for (const dependent of dependents.get(id) ?? []) {
        indegree.set(dependent, indegree.get(dependent) - 1);
        if (indegree.get(dependent) === 0) next.push(dependent);
      }
    }
    ready = [...new Set(next)].sort();
  }
  if (seen.size !== modules.length) {
    const unresolved = modules.map((module) => module.id).filter((id) => !seen.has(id));
    throw new Error(`Workspace dependency graph contains a cycle: ${unresolved.join(", ")}`);
  }
  return levels;
}

export function transitiveDependents(modules, selectedIds) {
  const reverse = new Map(modules.map((module) => [module.id, []]));
  for (const module of modules) {
    for (const dependency of module.dependencies ?? []) reverse.get(dependency)?.push(module.id);
  }
  const output = new Set(selectedIds);
  const queue = [...selectedIds];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of reverse.get(current) ?? []) {
      if (output.has(dependent)) continue;
      output.add(dependent);
      queue.push(dependent);
    }
  }
  return output;
}

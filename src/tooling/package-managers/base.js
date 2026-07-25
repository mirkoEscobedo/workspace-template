export function dependencySpec(request) {
  if (!request?.name) throw new Error("Dependency name is required");
  return request.version ? `${request.name}@${request.version}` : request.name;
}

export function isLocalDependency(request) {
  const value = request.version ?? request.name;
  return /^(file:|link:|workspace:|path:|\.\.?[\\/]|[A-Za-z]:[\\/])/.test(value);
}

export function nodeDependencyKindFlag(kind = "development", manager = "npm") {
  if (kind === "runtime") return manager === "npm" ? ["--save"] : [];
  if (kind === "build") throw new Error(`${manager} does not expose a separate build-dependency kind`);
  if (manager === "npm" || manager === "pnpm") return ["--save-dev"];
  if (manager === "yarn" || manager === "bun") return ["--dev"];
  return [];
}

export function createAdapter(name, definition) {
  if (!name || !definition?.manifest || typeof definition.planAdd !== "function") {
    throw new Error("Invalid package-manager adapter definition");
  }
  return Object.freeze({
    name,
    manifest: definition.manifest,
    lockfiles: [...(definition.lockfiles ?? [])],
    detect: definition.detect,
    planAdd(dependencies, options = {}) {
      const planned = definition.planAdd(dependencies, options);
      return {
        executable: planned.executable ?? planned.command ?? name,
        args: [...(planned.args ?? [])],
        network: planned.network ?? dependencies.some((item) => !isLocalDependency(item)),
        lifecycleScripts: Boolean(planned.lifecycleScripts),
        reason: planned.reason ?? `add dependencies with ${name}`,
      };
    },
  });
}

export function nodeAddCommand(manager, requests, options = {}) {
  const grouped = new Map();
  for (const request of requests) {
    const kind = request.kind ?? "development";
    const list = grouped.get(kind) ?? [];
    list.push(request);
    grouped.set(kind, list);
  }
  const commands = [];
  for (const [kind, dependencies] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const verb = manager === "npm" ? "install" : "add";
    const args = [verb, ...nodeDependencyKindFlag(kind, manager)];
    if (options.lifecycleScripts !== true && options.lifecycleScripts !== "allow") args.push("--ignore-scripts");
    args.push(...dependencies.map(dependencySpec));
    commands.push({
      executable: manager,
      args,
      network: dependencies.some((item) => !isLocalDependency(item)),
      lifecycleScripts: options.lifecycleScripts === true || options.lifecycleScripts === "allow",
      reason: `install ${kind} dependencies`,
    });
  }
  return commands;
}

export function cargoAddCommand(requests) {
  return requests.map((request) => ({
    executable: "cargo",
    args: [
      "add",
      ...((request.kind ?? "development") === "development" ? ["--dev"] : []),
      ...((request.kind ?? "development") === "build" ? ["--build"] : []),
      request.version ? `${request.name}@${request.version}` : request.name,
    ],
    network: !isLocalDependency(request),
    lifecycleScripts: false,
    reason: `add Cargo ${request.kind ?? "development"} dependency ${request.name}`,
  }));
}

export function flutterAddCommand(requests, project = "flutter") {
  return requests.map((request) => ({
    executable: project === "dart" ? "dart" : "flutter",
    args: [
      "pub",
      "add",
      ...((request.kind ?? "development") === "development" ? ["--dev"] : []),
      request.version ? `${request.name}:${request.version}` : request.name,
    ],
    network: !isLocalDependency(request),
    lifecycleScripts: false,
    reason: `add ${project} ${request.kind ?? "development"} dependency ${request.name}`,
  }));
}

import { createAdapter, dependencySpec, nodeDependencyKindFlag } from "./base.js";

export const bunAdapter = createAdapter("bun", {
  manifest: "package.json",
  lockfiles: ["bun.lock", "bun.lockb"],
  planAdd(dependencies, options = {}) {
    const kinds = new Set(dependencies.map((item) => item.kind ?? "development"));
    if (kinds.size > 1) throw new Error("Bun dependency operations must be grouped by dependency kind");
    return {
      command: "bun",
      args: ["add", ...nodeDependencyKindFlag([...kinds][0], "bun"), ...(options.lifecycleScripts === "allow" ? [] : ["--ignore-scripts"]), ...dependencies.map(dependencySpec)],
      lifecycleScripts: options.lifecycleScripts === "allow",
    };
  },
});

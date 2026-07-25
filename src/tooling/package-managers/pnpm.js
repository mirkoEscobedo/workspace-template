import { createAdapter, dependencySpec, nodeDependencyKindFlag } from "./base.js";

export const pnpmAdapter = createAdapter("pnpm", {
  manifest: "package.json",
  lockfiles: ["pnpm-lock.yaml"],
  planAdd(dependencies, options = {}) {
    const kinds = new Set(dependencies.map((item) => item.kind ?? "development"));
    if (kinds.size > 1) throw new Error("pnpm dependency operations must be grouped by dependency kind");
    return {
      command: "pnpm",
      args: ["add", ...nodeDependencyKindFlag([...kinds][0], "pnpm"), ...(options.lifecycleScripts === "allow" ? [] : ["--ignore-scripts"]), ...dependencies.map(dependencySpec)],
      lifecycleScripts: options.lifecycleScripts === "allow",
    };
  },
});

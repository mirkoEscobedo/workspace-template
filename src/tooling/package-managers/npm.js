import { createAdapter, dependencySpec, nodeDependencyKindFlag } from "./base.js";

export const npmAdapter = createAdapter("npm", {
  manifest: "package.json",
  lockfiles: ["package-lock.json"],
  planAdd(dependencies, options = {}) {
    const kinds = new Set(dependencies.map((item) => item.kind ?? "development"));
    if (kinds.size > 1) throw new Error("npm dependency operations must be grouped by dependency kind");
    return {
      command: "npm",
      args: ["install", ...nodeDependencyKindFlag([...kinds][0], "npm"), ...(options.lifecycleScripts === "allow" ? [] : ["--ignore-scripts"]), ...dependencies.map(dependencySpec)],
      lifecycleScripts: options.lifecycleScripts === "allow",
    };
  },
});

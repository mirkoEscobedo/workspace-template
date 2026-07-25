import { createAdapter, dependencySpec, nodeDependencyKindFlag } from "./base.js";

export const yarnAdapter = createAdapter("yarn", {
  manifest: "package.json",
  lockfiles: ["yarn.lock"],
  planAdd(dependencies, options = {}) {
    const kinds = new Set(dependencies.map((item) => item.kind ?? "development"));
    if (kinds.size > 1) throw new Error("Yarn dependency operations must be grouped by dependency kind");
    return {
      command: "yarn",
      args: ["add", ...nodeDependencyKindFlag([...kinds][0], "yarn"), ...(options.lifecycleScripts === "allow" ? [] : ["--ignore-scripts"]), ...dependencies.map(dependencySpec)],
      lifecycleScripts: options.lifecycleScripts === "allow",
    };
  },
});

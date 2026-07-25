import { createAdapter, isLocalDependency } from "./base.js";

export const cargoAdapter = createAdapter("cargo", {
  manifest: "Cargo.toml",
  lockfiles: ["Cargo.lock"],
  planAdd(dependencies) {
    if (dependencies.length !== 1) throw new Error("Cargo dependency additions are planned one crate at a time");
    const dependency = dependencies[0];
    const args = ["add"];
    if ((dependency.kind ?? "development") === "development") args.push("--dev");
    if ((dependency.kind ?? "development") === "build") args.push("--build");
    if (isLocalDependency(dependency)) {
      const localPath = String(dependency.version ?? dependency.name).replace(/^(?:path:|file:|link:)/, "");
      args.push(dependency.name, "--path", localPath);
    } else args.push(dependency.version ? `${dependency.name}@${dependency.version}` : dependency.name);
    return { command: "cargo", args, lifecycleScripts: false };
  },
});

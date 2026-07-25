import { createAdapter, isLocalDependency } from "./base.js";

export const flutterAdapter = createAdapter("flutter", {
  manifest: "pubspec.yaml",
  lockfiles: ["pubspec.lock"],
  planAdd(dependencies, options = {}) {
    if (dependencies.length !== 1) throw new Error("Flutter/Dart dependency additions are planned one package at a time");
    const dependency = dependencies[0];
    const tool = options.project === "dart" ? "dart" : "flutter";
    const args = ["pub", "add"];
    if ((dependency.kind ?? "development") === "development") args.push("--dev");
    if (isLocalDependency(dependency)) {
      const localPath = String(dependency.version ?? dependency.name).replace(/^(?:path:|file:|link:)/, "");
      args.push(dependency.name, "--path", localPath);
    } else args.push(dependency.version ? `${dependency.name}:${dependency.version}` : dependency.name);
    return { command: tool, args, lifecycleScripts: false };
  },
});

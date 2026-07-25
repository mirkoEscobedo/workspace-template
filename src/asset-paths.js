import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const assetsRoot = path.resolve(moduleDirectory, "..", "assets");
export const assetsSkills = path.join(assetsRoot, "skills");

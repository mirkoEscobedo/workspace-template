import { flutterScaffold, flutterStructure } from "./flutter.js";
import { javascriptScaffold, javascriptStructure } from "./javascript.js";
import { reactScaffold, reactStructure } from "./react.js";
import { rustScaffold, rustStructure } from "./rust.js";
import { typescriptScaffold, typescriptStructure } from "./typescript.js";

export function createScaffold(context) {
  switch (context.project) {
    case "typescript":
      return typescriptScaffold({ name: context.npmName, style: context.style });
    case "javascript":
      return javascriptScaffold({ name: context.npmName, style: context.style });
    case "react":
      return reactScaffold({ name: context.npmName, style: context.style });
    case "rust":
      return rustScaffold({ crateName: context.rustCrateName, style: context.style });
    case "flutter":
      return flutterScaffold({ packageName: context.dartPackageName, style: context.style });
    default:
      throw new Error(`Unsupported project type: ${context.project}`);
  }
}

export function scaffoldStructure(project, style) {
  switch (project) {
    case "typescript":
      return typescriptStructure(style);
    case "javascript":
      return javascriptStructure(style);
    case "react":
      return reactStructure(style);
    case "rust":
      return rustStructure(style);
    case "flutter":
      return flutterStructure(style);
    default:
      throw new Error(`Unsupported project type: ${project}`);
  }
}

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CREATE_STYLES, CREATE_TDD_MODES, PROJECTS } from "./constants.js";

async function askText(reader, prompt, fallback) {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await reader.question(`${prompt}${suffix}: `)).trim();
  return answer || fallback;
}

async function askChoice(reader, prompt, choices, fallback) {
  output.write(`\n${prompt}\n`);
  choices.forEach((choice, index) => {
    output.write(`  ${index + 1}. ${choice}${choice === fallback ? " (default)" : ""}\n`);
  });
  const raw = (await reader.question("> ")).trim();
  if (!raw) return fallback;
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1];
  }
  if (choices.includes(raw)) return raw;
  throw new Error(`Choose one of: ${choices.join(", ")}`);
}

export async function fillInteractiveOptions(options) {
  if (options.yes) {
    return {
      ...options,
      target: options.target ?? "workspace-template-project",
      project: options.project ?? "typescript",
    };
  }

  const needsPrompt = !options.target || !options.project;
  if (!needsPrompt) return options;

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "A target directory and --project are required in non-interactive mode. Example: npx workspace-template my-app --project typescript --yes",
    );
  }

  const reader = createInterface({ input, output });
  try {
    const target = options.target ?? (await askText(reader, "Project directory", "workspace-template-project"));
    const project =
      options.project ??
      (await askChoice(reader, "Language or framework", PROJECTS, "typescript"));
    const style = await askChoice(reader, "Implementation style", CREATE_STYLES, options.style);
    const tdd = await askChoice(reader, "TDD mode", CREATE_TDD_MODES, options.tdd);
    return { ...options, target, project, style, tdd };
  } finally {
    reader.close();
  }
}

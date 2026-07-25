import { npmAdapter } from "./npm.js";
import { pnpmAdapter } from "./pnpm.js";
import { yarnAdapter } from "./yarn.js";
import { bunAdapter } from "./bun.js";
import { cargoAdapter } from "./cargo.js";
import { flutterAdapter } from "./flutter.js";

const ADAPTERS = new Map([
  ["npm", npmAdapter],
  ["pnpm", pnpmAdapter],
  ["yarn", yarnAdapter],
  ["bun", bunAdapter],
  ["cargo", cargoAdapter],
  ["flutter", flutterAdapter],
  ["dart", flutterAdapter],
]);

export function packageManagerAdapter(name) {
  const adapter = ADAPTERS.get(name);
  if (!adapter) throw new Error(`Unsupported package manager adapter: ${name}`);
  return adapter;
}

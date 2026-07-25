import { DEPENDENCY_SNAPSHOT } from "../constants.js";
import { asJson, biomeConfig, nodeGitignore } from "./shared.js";

function packageJson(name) {
  const d = DEPENDENCY_SNAPSHOT;
  return asJson({
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc --noEmit && vite build",
      preview: "vite preview",
      test: "vitest run",
      "test:watch": "vitest",
      typecheck: "tsc --noEmit",
      lint: "biome lint src vite.config.ts",
      format: "biome format --write src vite.config.ts",
      check: "tsc --noEmit && biome lint src vite.config.ts && vitest run && vite build",
    },
    dependencies: {
      react: d.react,
      "react-dom": d.reactDom,
    },
    devDependencies: {
      "@biomejs/biome": d.biome,
      "@testing-library/jest-dom": d.testingLibraryJestDom,
      "@testing-library/react": d.testingLibraryReact,
      "@types/react": d.typesReact,
      "@types/react-dom": d.typesReactDom,
      "@vitejs/plugin-react": d.viteReact,
      jsdom: d.jsdom,
      typescript: d.typescript,
      vite: d.vite,
      vitest: d.vitest,
    },
    engines: { node: ">=24" },
  });
}

const tsconfig = asJson({
  compilerOptions: {
    target: "ES2023",
    useDefineForClassFields: true,
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    allowJs: false,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    useUnknownInCatchVariables: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    module: "ESNext",
    moduleResolution: "Bundler",
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: "react-jsx",
    types: ["vitest/globals", "@testing-library/jest-dom"],
  },
  include: ["src", "vite.config.ts"],
});

const viteConfig = `import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
`;

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Agent-ready React starter" />
    <title>Agentic React Starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const styles = `:root {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #172033;
  background: #f4f6fb;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
button { font: inherit; }

main {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
}

.counter {
  width: min(100%, 32rem);
  padding: 2rem;
  border: 1px solid #d9deea;
  border-radius: 1rem;
  background: white;
  box-shadow: 0 1rem 3rem rgb(39 54 86 / 10%);
  text-align: center;
}

.counter__value { font-size: 4rem; font-weight: 700; margin: 1rem 0; }
.counter__actions { display: flex; justify-content: center; gap: 0.75rem; }
.counter button {
  min-width: 7rem;
  padding: 0.65rem 1rem;
  border: 1px solid #aab5ca;
  border-radius: 0.6rem;
  background: #f8f9fc;
  cursor: pointer;
}
.counter button:hover { background: #edf1f8; }
`;

const domain = `export interface CounterState {
  readonly value: number;
}

export type CounterAction =
  | { readonly type: "increment" }
  | { readonly type: "decrement" }
  | { readonly type: "reset" };

export const initialCounterState: CounterState = { value: 0 };

export function reduceCounter(
  state: CounterState,
  action: CounterAction,
): CounterState {
  switch (action.type) {
    case "increment":
      return { value: state.value + 1 };
    case "decrement":
      return { value: state.value - 1 };
    case "reset":
      return initialCounterState;
  }
}
`;

function hook(domainImport) {
  return `import { useReducer } from "react";
import { initialCounterState, reduceCounter } from "${domainImport}";

export function useCounter() {
  const [state, dispatch] = useReducer(reduceCounter, initialCounterState);

  return {
    value: state.value,
    increment: () => dispatch({ type: "increment" }),
    decrement: () => dispatch({ type: "decrement" }),
    reset: () => dispatch({ type: "reset" }),
  } as const;
}
`;
}

function component(hookImport) {
  return `import { useCounter } from "${hookImport}";

export function Counter() {
  const counter = useCounter();

  return (
    <section className="counter" aria-labelledby="counter-title">
      <h1 id="counter-title">Counter</h1>
      <output className="counter__value" aria-live="polite">
        {counter.value}
      </output>
      <div className="counter__actions">
        <button type="button" onClick={counter.decrement}>Decrease</button>
        <button type="button" onClick={counter.increment}>Increase</button>
        <button type="button" onClick={counter.reset}>Reset</button>
      </div>
    </section>
  );
}
`;
}

function app(componentImport) {
  return `import { Counter } from "${componentImport}";

export function App() {
  return (
    <main>
      <Counter />
    </main>
  );
}
`;
}

const main = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

function domainTest(domainImport) {
  return `import { expect, it } from "vitest";
import { initialCounterState, reduceCounter } from "${domainImport}";

it("increments without mutating the previous state", () => {
  const previous = initialCounterState;
  const next = reduceCounter(previous, { type: "increment" });

  expect(next).toEqual({ value: 1 });
  expect(previous).toEqual({ value: 0 });
});
`;
}

function componentTest(componentImport) {
  return `import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Counter } from "${componentImport}";

it("increments when the user activates Increase", () => {
  render(<Counter />);

  fireEvent.click(screen.getByRole("button", { name: "Increase" }));

  expect(screen.getByRole("status")).toHaveTextContent("1");
});
`;
}

function paths(style) {
  if (style === "simple") {
    return {
      domain: "src/features/counter/counter.ts",
      hook: "src/features/counter/use-counter.ts",
      component: "src/features/counter/Counter.tsx",
      domainFromHook: "./counter",
      hookFromComponent: "./use-counter",
      componentFromApp: "./features/counter/Counter",
      domainTest: "src/features/counter/counter.test.ts",
      componentTest: "src/features/counter/Counter.test.tsx",
      domainFromTest: "./counter",
      componentFromTest: "./Counter",
    };
  }
  if (style === "clean") {
    return {
      domain: "src/domain/counter.ts",
      hook: "src/application/use-counter.ts",
      component: "src/presentation/Counter.tsx",
      domainFromHook: "../domain/counter",
      hookFromComponent: "../application/use-counter",
      componentFromApp: "./presentation/Counter",
      domainTest: "src/domain/counter.test.ts",
      componentTest: "src/presentation/Counter.test.tsx",
      domainFromTest: "./counter",
      componentFromTest: "./Counter",
    };
  }
  return {
    domain: "src/features/counter/domain/counter.ts",
    hook: "src/features/counter/application/use-counter.ts",
    component: "src/features/counter/ui/Counter.tsx",
    domainFromHook: "../domain/counter",
    hookFromComponent: "../application/use-counter",
    componentFromApp: "./features/counter/ui/Counter",
    domainTest: "src/features/counter/domain/counter.test.ts",
    componentTest: "src/features/counter/ui/Counter.test.tsx",
    domainFromTest: "./counter",
    componentFromTest: "./Counter",
  };
}

export function reactScaffold({ name, style }) {
  const p = paths(style);
  return {
    "package.json": packageJson(name),
    "tsconfig.json": tsconfig,
    "vite.config.ts": viteConfig,
    "biome.json": biomeConfig(),
    "index.html": indexHtml,
    ".gitignore": nodeGitignore(),
    "src/styles.css": styles,
    "src/vite-env.d.ts": '/// <reference types="vite/client" />\n',
    "src/main.tsx": main,
    "src/test/setup.ts": 'import "@testing-library/jest-dom/vitest";\n',
    "src/App.tsx": app(p.componentFromApp),
    [p.domain]: domain,
    [p.hook]: hook(p.domainFromHook),
    [p.component]: component(p.hookFromComponent),
    [p.domainTest]: domainTest(p.domainFromTest),
    [p.componentTest]: componentTest(p.componentFromTest),
  };
}

export function reactStructure(style) {
  if (style === "simple") {
    return `src/\n├── features/counter/\n│   ├── counter.ts\n│   ├── use-counter.ts\n│   └── Counter.tsx\n├── App.tsx\n└── main.tsx`;
  }
  if (style === "clean") {
    return `src/\n├── domain/\n├── application/\n├── presentation/\n├── App.tsx\n└── main.tsx`;
  }
  return `src/\n├── features/counter/\n│   ├── domain/\n│   ├── application/\n│   └── ui/\n├── App.tsx\n└── main.tsx`;
}

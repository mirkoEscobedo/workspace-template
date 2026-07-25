function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function effectNames(findings) {
  return unique(findings.map((item) => item.effect));
}

function task(key, title, kind, recipe, acceptanceCriteria) {
  return { key, title, kind, recipe, acceptanceCriteria };
}

export const ALIGNMENT_RECIPES = Object.freeze({
  "functional-core": Object.freeze({
    name: "functional-core-imperative-shell",
    invariants: Object.freeze([
      "observable behavior remains unchanged unless acceptance criteria authorize a change",
      "time, randomness, environment, identity, and external data become explicit at the pure-policy boundary",
      "transactions remain around the complete application use case",
      "ports are introduced only for a real volatile boundary or useful test seam",
      "stateless calculations remain functions unless state or dependency ownership justifies an object",
    ]),
    antiPatterns: Object.freeze([
      "database, HTTP, filesystem, queue, clock, randomness, or environment reads inside extracted policy",
      "class-for-one-function or interface/implementation ceremony without dependency ownership or volatility",
      "transactions split between pure policy and adapters",
      "horizontal big-bang migration across several use cases",
    ]),
  }),
  clean: Object.freeze({
    name: "clean-ports-and-adapters",
    invariants: Object.freeze([
      "domain/application policy does not depend on framework or database types in the selected slice",
      "application-owned ports express an actual use-case need",
      "mapping between external DTOs/rows and domain/application values occurs at the boundary",
      "transactions remain around the complete use case",
      "composition happens at an explicit root",
      "no IThing/ThingImpl or generic CRUD ceremony is introduced without a real boundary",
    ]),
    antiPatterns: Object.freeze([
      "one repository interface per table",
      "universal CRUD service/repository abstractions",
      "framework/database DTOs crossing into policy",
      "service locator or global dependency access",
      "moving every folder before one behavior slice is protected",
    ]),
  }),
  simple: Object.freeze({
    name: "simple-explicit-effects",
    invariants: Object.freeze([
      "preserve cohesive local structure",
      "make touched effects visible",
      "add regression protection at a public seam",
      "do not introduce architectural layers without complexity that requires them",
    ]),
    antiPatterns: Object.freeze([
      "introducing domain/application/adapter folders for a locally cohesive change",
      "creating interfaces or factories for one concrete local dependency",
      "spreading a known local anti-pattern merely for consistency",
      "changing unrelated modules while simplifying the selected use case",
    ]),
  }),
});

export function recipeFor(style) {
  const recipe = ALIGNMENT_RECIPES[style];
  if (!recipe) throw new Error(`Unknown alignment style '${style}'`);
  return recipe;
}

/**
 * Expand one style recipe into bounded task templates. The planner supplies
 * source-located effect evidence and decides whether characterization already
 * exists; recipes never invent a port/layer when the evidence does not justify
 * it.
 */
export function buildRecipeTasks(style, context) {
  const hidden = effectNames(context.hiddenEffects ?? []);
  const volatile = effectNames(context.volatileEffects ?? []);
  const allEffects = effectNames(context.effects ?? []);
  const tasks = [];
  if (context.includeCharacterization) {
    tasks.push(task(
      "characterize",
      "Protect the observable use case through a public seam",
      "characterization",
      `${style}:characterize`,
      [
        "Add or confirm behavior-focused characterization/regression coverage through the observable public seam.",
        "Expected values are independent of the production implementation.",
        "Baseline behavior and known accepted failures are recorded.",
      ],
    ));
  }

  if (style === "simple") {
    if (allEffects.length > 0) {
      tasks.push(task(
        "make-effects-visible",
        "Make touched effects and hidden inputs visible",
        "semantic",
        "simple:explicit-effects",
        [
          `Keep the observed ${allEffects.join(", ")} effects at clear call sites or edge helpers.`,
          "Do not introduce a new architectural layer unless a real volatile boundary requires it.",
          "Preserve observable behavior and existing coherent module ownership.",
        ],
      ));
    }
    tasks.push(task(
      "simplify",
      "Keep the smallest cohesive implementation",
      "semantic",
      "simple:cohesive-change",
      [
        "Keep related behavior together in the selected feature/module.",
        "Use a function for stateless behavior and an object only for meaningful state, invariants, or dependency ownership.",
        "Do not add ports, repositories, factories, or generic services without evidence that they solve a real boundary problem.",
      ],
    ));
    tasks.push(task(
      "verify",
      "Prove the complete cohesive change",
      "integration-review",
      "simple:verify",
      [
        "Targeted and module verification pass.",
        "No unrelated module or public behavior changed.",
        "Requirements and engineering-quality reviews have no blocking findings.",
      ],
    ));
    return tasks;
  }

  if (style === "functional-core") {
    if (hidden.length > 0) {
      tasks.push(task(
        "explicit-inputs",
        "Make hidden nondeterministic inputs explicit at the policy boundary",
        "semantic",
        "functional-core:explicit-inputs",
        [
          `Expose ${hidden.join(", ")} as inputs or edge dependencies.`,
          "Preserve externally observable behavior.",
          "Keep the core deterministic under tests.",
        ],
      ));
    }
    tasks.push(task(
      "extract-policy",
      "Extract or strengthen pure business policy",
      "semantic",
      "functional-core:extract-policy",
      [
        "Calculations, validation, state transitions, and transformations are pure where practical.",
        "No database, HTTP, filesystem, queue, environment, clock, or randomness access remains in extracted policy.",
        "Public behavior is unchanged unless explicitly listed in the acceptance criteria.",
      ],
    ));
    tasks.push(task(
      "application-shell",
      "Establish a use-case/application shell around the policy",
      "semantic",
      "functional-core:application-shell",
      [
        "The application shell owns effect ordering and transaction boundaries.",
        "Dependencies are visible at construction or call sites.",
        "The use case remains testable with owned fakes at real volatile boundaries.",
      ],
    ));
    if (volatile.length > 0) {
      tasks.push(task(
        "effect-boundary",
        "Reuse or introduce only the meaningful volatile-effect boundary",
        "semantic",
        "functional-core:effect-boundary",
        [
          `Represent only the observed ${volatile.join(", ")} capability required by the use case.`,
          "Do not introduce generic CRUD repositories, IThing/ThingImpl pairs, or factories without a second implementation or useful seam.",
          "Map external rows/DTOs to policy values at the edge.",
        ],
      ));
    }
    tasks.push(task(
      "wire-review",
      "Wire at the composition root and prove the complete slice",
      "integration-review",
      "functional-core:wire",
      [
        "Composition and concrete effect wiring remain at an explicit edge.",
        "Targeted and module verification pass.",
        "Requirements and engineering-quality reviews have no blocking findings.",
        "No unrelated module or use case changed.",
      ],
    ));
    return tasks;
  }

  // clean
  tasks.push(task(
    "select-use-case",
    "Isolate one application use case from the delivery/service workflow",
    "semantic",
    "clean:application-use-case",
    [
      "One observable use case owns orchestration, effect ordering, and transaction scope.",
      "Delivery/framework code calls the application boundary rather than containing business policy.",
      "Existing meaningful application boundaries are reused rather than duplicated.",
    ],
  ));
  tasks.push(task(
    "extract-policy",
    "Move selected business decisions into framework-independent policy",
    "semantic",
    "clean:extract-policy",
    [
      "Selected domain/application policy does not import database, HTTP, UI, or framework types.",
      "Business calculations, validation, and state transitions remain independently testable.",
      "Externally observable behavior remains unchanged unless explicitly authorized.",
    ],
  ));
  if (volatile.length > 0) {
    tasks.push(task(
      "port-adapter",
      "Define or reuse the application-owned port and concrete adapter",
      "semantic",
      "clean:port-adapter",
      [
        `The port expresses only the observed ${volatile.join(", ")} capability required by this use case.`,
        "Concrete DTO/row mapping and external effects remain in the adapter.",
        "No generic CRUD or one-interface-per-table abstraction is added.",
      ],
    ));
  }
  tasks.push(task(
    "delivery",
    "Keep framework and delivery concerns at the edge",
    "semantic",
    "clean:delivery",
    [
      "HTTP/UI/framework request and response mapping stays in delivery code.",
      "Application/domain policy remains framework independent for the selected slice.",
      "Error and transaction semantics remain explicit.",
    ],
  ));
  tasks.push(task(
    "wire-review",
    "Wire the use case at a composition root and prove the complete slice",
    "integration-review",
    "clean:wire",
    [
      "Concrete adapters are selected at an explicit composition root.",
      "Targeted and module verification pass.",
      "Requirements and engineering-quality reviews have no blocking findings.",
      "No unrelated use case or module changed.",
    ],
  ));
  return tasks;
}

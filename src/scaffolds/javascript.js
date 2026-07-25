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
      dev: "node src/index.js",
      test: "node --test",
      typecheck: "tsc --noEmit",
      lint: "biome lint src test",
      format: "biome format --write src test",
      check: "tsc --noEmit && biome lint src test && node --test",
    },
    devDependencies: {
      "@biomejs/biome": d.biome,
      "@types/node": d.typesNode,
      typescript: d.typescript,
    },
    engines: { node: ">=24" },
  });
}

const tsconfig = asJson({
  compilerOptions: {
    target: "ES2023",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    moduleDetection: "force",
    allowJs: true,
    checkJs: true,
    noEmit: true,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    useUnknownInCatchVariables: true,
    noImplicitOverride: true,
    types: ["node"],
  },
  include: ["src/**/*.js", "test/**/*.js"],
});

const domain = `// @ts-check

/** @typedef {string} OrderId */

/**
 * @typedef {Readonly<{
 *   id: OrderId,
 *   subtotalCents: number,
 *   totalCents: number,
 *   customerIsPremium: boolean,
 * }>} Order
 */

/**
 * @param {number} subtotalCents
 * @param {boolean} customerIsPremium
 * @returns {number}
 */
export function calculateDiscountCents(subtotalCents, customerIsPremium) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new RangeError("subtotalCents must be a non-negative safe integer");
  }
  return customerIsPremium ? Math.floor(subtotalCents / 10) : 0;
}

/**
 * @param {Order} order
 * @returns {Order}
 */
export function calculateOrderTotal(order) {
  const discountCents = calculateDiscountCents(
    order.subtotalCents,
    order.customerIsPremium,
  );
  return { ...order, totalCents: order.subtotalCents - discountCents };
}
`;

const port = `// @ts-check

/** @typedef {import("../domain/order.js").Order} Order */
/** @typedef {import("../domain/order.js").OrderId} OrderId */

/**
 * @typedef {object} OrderRepository
 * @property {(id: OrderId) => Promise<Order | null>} findById
 * @property {(order: Order) => Promise<void>} save
 */

export {};
`;

const application = `// @ts-check

import { calculateOrderTotal } from "../domain/order.js";

/** @typedef {import("../domain/order.js").Order} Order */
/** @typedef {import("../domain/order.js").OrderId} OrderId */
/** @typedef {import("../ports/order-repository.js").OrderRepository} OrderRepository */

export class OrderNotFoundError extends Error {
  /** @param {OrderId} orderId */
  constructor(orderId) {
    super(\`Order \${orderId} was not found\`);
    this.name = "OrderNotFoundError";
    this.orderId = orderId;
  }
}

/**
 * @param {OrderRepository} orders
 * @param {OrderId} orderId
 * @returns {Promise<Order>}
 */
export async function processOrder(orders, orderId) {
  const order = await orders.findById(orderId);
  if (order === null) throw new OrderNotFoundError(orderId);
  const processed = calculateOrderTotal(order);
  await orders.save(processed);
  return processed;
}
`;

const adapter = `// @ts-check

/** @typedef {import("../domain/order.js").Order} Order */
/** @typedef {import("../domain/order.js").OrderId} OrderId */

export class InMemoryOrderRepository {
  /** @type {Map<OrderId, Order>} */
  #orders = new Map();

  /** @param {readonly Order[]} [initialOrders] */
  constructor(initialOrders = []) {
    for (const order of initialOrders) this.#orders.set(order.id, order);
  }

  /** @param {OrderId} id */
  async findById(id) {
    return this.#orders.get(id) ?? null;
  }

  /** @param {Order} order */
  async save(order) {
    this.#orders.set(order.id, order);
  }

  /** @param {OrderId} id */
  stored(id) {
    return this.#orders.get(id);
  }
}
`;

const indexFunctional = `import { processOrder } from "./orders/application/process-order.js";
import { InMemoryOrderRepository } from "./orders/adapters/in-memory-order-repository.js";

const orders = new InMemoryOrderRepository([
  {
    id: "order-1",
    subtotalCents: 10_000,
    totalCents: 0,
    customerIsPremium: true,
  },
]);

const processed = await processOrder(orders, "order-1");
console.log(\`Processed \${processed.id}: \${processed.totalCents} cents\`);
`;

const testFunctional = `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { processOrder } from "../../src/orders/application/process-order.js";
import { InMemoryOrderRepository } from "../../src/orders/adapters/in-memory-order-repository.js";
import { calculateOrderTotal } from "../../src/orders/domain/order.js";

describe("order processing", () => {
  it("applies a ten percent discount to premium orders", () => {
    const result = calculateOrderTotal({
      id: "order-1",
      subtotalCents: 10_000,
      totalCents: 0,
      customerIsPremium: true,
    });
    assert.equal(result.totalCents, 9_000);
  });

  it("persists the processed order through the use-case boundary", async () => {
    const repository = new InMemoryOrderRepository([
      {
        id: "order-1",
        subtotalCents: 10_000,
        totalCents: 0,
        customerIsPremium: true,
      },
    ]);

    await processOrder(repository, "order-1");
    assert.equal(repository.stored("order-1")?.totalCents, 9_000);
  });
});
`;

function functionalFiles() {
  return {
    "src/orders/domain/order.js": domain,
    "src/orders/ports/order-repository.js": port,
    "src/orders/application/process-order.js": application,
    "src/orders/adapters/in-memory-order-repository.js": adapter,
    "src/index.js": indexFunctional,
    "test/orders/process-order.test.js": testFunctional,
  };
}

function simpleFiles() {
  const order = `${domain}
/**
 * @typedef {object} OrderStore
 * @property {(id: OrderId) => Promise<Order | null>} findById
 * @property {(order: Order) => Promise<void>} save
 */

/**
 * @param {OrderStore} store
 * @param {OrderId} orderId
 * @returns {Promise<Order>}
 */
export async function processOrder(store, orderId) {
  const order = await store.findById(orderId);
  if (order === null) throw new Error(\`Order \${orderId} was not found\`);
  const processed = calculateOrderTotal(order);
  await store.save(processed);
  return processed;
}
`;
  return {
    "src/order.js": order,
    "src/index.js": `import { calculateOrderTotal } from "./order.js";

const order = calculateOrderTotal({
  id: "order-1",
  subtotalCents: 10_000,
  totalCents: 0,
  customerIsPremium: true,
});

console.log(\`Processed \${order.id}: \${order.totalCents} cents\`);
`,
    "test/order.test.js": `import assert from "node:assert/strict";
import { it } from "node:test";
import { calculateOrderTotal } from "../src/order.js";

it("applies a ten percent discount to premium orders", () => {
  const result = calculateOrderTotal({
    id: "order-1",
    subtotalCents: 10_000,
    totalCents: 0,
    customerIsPremium: true,
  });
  assert.equal(result.totalCents, 9_000);
});
`,
  };
}

function cleanFiles() {
  return {
    "src/domain/order.js": domain,
    "src/application/ports/order-repository.js": port.replaceAll(
      '"../domain/order.js"',
      '"../../domain/order.js"',
    ),
    "src/application/use-cases/process-order.js": application
      .replaceAll('"../domain/order.js"', '"../../domain/order.js"')
      .replace('"../ports/order-repository.js"', '"../ports/order-repository.js"'),
    "src/infrastructure/in-memory-order-repository.js": adapter
      .replace('"../domain/order.js"', '"../domain/order.js"')
      .replace('"../ports/order-repository.js"', '"../application/ports/order-repository.js"'),
    "src/index.js": indexFunctional
      .replace('"./orders/application/process-order.js"', '"./application/use-cases/process-order.js"')
      .replace(
        '"./orders/adapters/in-memory-order-repository.js"',
        '"./infrastructure/in-memory-order-repository.js"',
      ),
    "test/process-order.test.js": testFunctional
      .replace(
        '"../../src/orders/application/process-order.js"',
        '"../src/application/use-cases/process-order.js"',
      )
      .replace(
        '"../../src/orders/adapters/in-memory-order-repository.js"',
        '"../src/infrastructure/in-memory-order-repository.js"',
      )
      .replace('"../../src/orders/domain/order.js"', '"../src/domain/order.js"'),
  };
}

export function javascriptScaffold({ name, style }) {
  const styleFiles = {
    simple: simpleFiles,
    "functional-core": functionalFiles,
    clean: cleanFiles,
  }[style]();

  return {
    "package.json": packageJson(name),
    "tsconfig.json": tsconfig,
    "biome.json": biomeConfig(),
    ".gitignore": nodeGitignore(),
    ...styleFiles,
  };
}

export function javascriptStructure(style) {
  if (style === "simple") return `src/\n├── index.js\n└── order.js\ntest/\n└── order.test.js`;
  if (style === "clean") {
    return `src/\n├── domain/\n├── application/\n│   ├── ports/\n│   └── use-cases/\n├── infrastructure/\n└── index.js\ntest/`;
  }
  return `src/\n├── orders/\n│   ├── domain/\n│   ├── application/\n│   ├── ports/\n│   └── adapters/\n└── index.js\ntest/`;
}

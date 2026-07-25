import { DEPENDENCY_SNAPSHOT } from "../constants.js";
import { biomeConfig, asJson, nodeGitignore } from "./shared.js";

function packageJson(name) {
  const d = DEPENDENCY_SNAPSHOT;
  return asJson({
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "tsx src/index.ts",
      test: "vitest run",
      "test:watch": "vitest",
      typecheck: "tsc --noEmit",
      lint: "biome lint src test",
      format: "biome format --write src test",
      check: "tsc --noEmit && biome lint src test && vitest run",
    },
    devDependencies: {
      "@biomejs/biome": d.biome,
      "@types/node": d.typesNode,
      tsx: d.tsx,
      typescript: d.typescript,
      vitest: d.vitest,
    },
    engines: { node: ">=24" },
  });
}

const tsconfig = asJson({
  compilerOptions: {
    target: "ES2023",
    lib: ["ES2023"],
    module: "NodeNext",
    moduleResolution: "NodeNext",
    moduleDetection: "force",
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    useUnknownInCatchVariables: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
    verbatimModuleSyntax: true,
    types: ["node", "vitest/globals"],
  },
  include: ["src/**/*.ts", "test/**/*.ts"],
});

const domain = `export type OrderId = string;

export interface Order {
  readonly id: OrderId;
  readonly subtotalCents: number;
  readonly totalCents: number;
  readonly customerIsPremium: boolean;
}

export function calculateDiscountCents(
  subtotalCents: number,
  customerIsPremium: boolean,
): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new RangeError("subtotalCents must be a non-negative safe integer");
  }

  return customerIsPremium ? Math.floor(subtotalCents / 10) : 0;
}

export function calculateOrderTotal(order: Order): Order {
  const discountCents = calculateDiscountCents(
    order.subtotalCents,
    order.customerIsPremium,
  );

  return {
    ...order,
    totalCents: order.subtotalCents - discountCents,
  };
}
`;

const port = `import type { Order, OrderId } from "../domain/order.js";

export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}
`;

const application = `import { calculateOrderTotal, type Order, type OrderId } from "../domain/order.js";
import type { OrderRepository } from "../ports/order-repository.js";

export class OrderNotFoundError extends Error {
  public constructor(public readonly orderId: OrderId) {
    super(\`Order \${orderId} was not found\`);
    this.name = "OrderNotFoundError";
  }
}

export async function processOrder(
  orders: OrderRepository,
  orderId: OrderId,
): Promise<Order> {
  const order = await orders.findById(orderId);
  if (order === null) throw new OrderNotFoundError(orderId);

  const processed = calculateOrderTotal(order);
  await orders.save(processed);
  return processed;
}
`;

const adapter = `import type { Order, OrderId } from "../domain/order.js";
import type { OrderRepository } from "../ports/order-repository.js";

export class InMemoryOrderRepository implements OrderRepository {
  readonly #orders = new Map<OrderId, Order>();

  public constructor(initialOrders: readonly Order[] = []) {
    for (const order of initialOrders) this.#orders.set(order.id, order);
  }

  public async findById(id: OrderId): Promise<Order | null> {
    return this.#orders.get(id) ?? null;
  }

  public async save(order: Order): Promise<void> {
    this.#orders.set(order.id, order);
  }

  public stored(id: OrderId): Order | undefined {
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

const testFunctional = `import { describe, expect, it } from "vitest";
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

    expect(result.totalCents).toBe(9_000);
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

    expect(repository.stored("order-1")?.totalCents).toBe(9_000);
  });
});
`;

function functionalCoreFiles() {
  return {
    "src/orders/domain/order.ts": domain,
    "src/orders/ports/order-repository.ts": port,
    "src/orders/application/process-order.ts": application,
    "src/orders/adapters/in-memory-order-repository.ts": adapter,
    "src/index.ts": indexFunctional,
    "test/orders/process-order.test.ts": testFunctional,
  };
}

function simpleFiles() {
  const order = `${domain}
export interface OrderStore {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

export async function processOrder(store: OrderStore, orderId: OrderId): Promise<Order> {
  const order = await store.findById(orderId);
  if (order === null) throw new Error(\`Order \${orderId} was not found\`);
  const processed = calculateOrderTotal(order);
  await store.save(processed);
  return processed;
}
`;
  const index = `import { calculateOrderTotal } from "./order.js";

const order = calculateOrderTotal({
  id: "order-1",
  subtotalCents: 10_000,
  totalCents: 0,
  customerIsPremium: true,
});

console.log(\`Processed \${order.id}: \${order.totalCents} cents\`);
`;
  const test = `import { expect, it } from "vitest";
import { calculateOrderTotal } from "../src/order.js";

it("applies a ten percent discount to premium orders", () => {
  const result = calculateOrderTotal({
    id: "order-1",
    subtotalCents: 10_000,
    totalCents: 0,
    customerIsPremium: true,
  });

  expect(result.totalCents).toBe(9_000);
});
`;
  return {
    "src/order.ts": order,
    "src/index.ts": index,
    "test/order.test.ts": test,
  };
}

function cleanFiles() {
  return {
    "src/domain/order.ts": domain,
    "src/application/ports/order-repository.ts": port.replace(
      '"../domain/order.js"',
      '"../../domain/order.js"',
    ),
    "src/application/use-cases/process-order.ts": application
      .replace('"../domain/order.js"', '"../../domain/order.js"')
      .replace('"../ports/order-repository.js"', '"../ports/order-repository.js"'),
    "src/infrastructure/in-memory-order-repository.ts": adapter
      .replace('"../domain/order.js"', '"../domain/order.js"')
      .replace('"../ports/order-repository.js"', '"../application/ports/order-repository.js"'),
    "src/index.ts": indexFunctional
      .replace('"./orders/application/process-order.js"', '"./application/use-cases/process-order.js"')
      .replace(
        '"./orders/adapters/in-memory-order-repository.js"',
        '"./infrastructure/in-memory-order-repository.js"',
      ),
    "test/process-order.test.ts": testFunctional
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

export function typescriptScaffold({ name, style }) {
  const styleFiles = {
    simple: simpleFiles,
    "functional-core": functionalCoreFiles,
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

export function typescriptStructure(style) {
  if (style === "simple") return `src/\n├── index.ts\n└── order.ts\ntest/\n└── order.test.ts`;
  if (style === "clean") {
    return `src/\n├── domain/\n├── application/\n│   ├── ports/\n│   └── use-cases/\n├── infrastructure/\n└── index.ts\ntest/`;
  }
  return `src/\n├── orders/\n│   ├── domain/\n│   ├── application/\n│   ├── ports/\n│   └── adapters/\n└── index.ts\ntest/`;
}

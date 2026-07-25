function cargoToml(crateName) {
  return `[package]
name = "${crateName}"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"
publish = false

[dependencies]

[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
all = "warn"
`;
}

const domain = `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OrderId(pub u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: OrderId,
    pub subtotal_cents: u64,
    pub total_cents: u64,
    pub customer_is_premium: bool,
}

#[must_use]
pub const fn calculate_discount_cents(
    subtotal_cents: u64,
    customer_is_premium: bool,
) -> u64 {
    if customer_is_premium {
        subtotal_cents / 10
    } else {
        0
    }
}

#[must_use]
pub fn calculate_order_total(order: &Order) -> Order {
    let discount_cents =
        calculate_discount_cents(order.subtotal_cents, order.customer_is_premium);

    Order {
        total_cents: order.subtotal_cents - discount_cents,
        ..order.clone()
    }
}
`;

function port(domainPath) {
  return `use ${domainPath}::{Order, OrderId};

pub trait OrderRepository {
    type Error;

    fn find_by_id(&self, id: OrderId) -> Result<Option<Order>, Self::Error>;
    fn save(&mut self, order: &Order) -> Result<(), Self::Error>;
}
`;
}

function application(domainPath, portPath) {
  return `use ${domainPath}::{calculate_order_total, Order, OrderId};
use ${portPath}::OrderRepository;

#[derive(Debug, PartialEq, Eq)]
pub enum ProcessOrderError<E> {
    NotFound(OrderId),
    Repository(E),
}

pub fn process_order<R>(
    orders: &mut R,
    order_id: OrderId,
) -> Result<Order, ProcessOrderError<R::Error>>
where
    R: OrderRepository,
{
    let order = orders
        .find_by_id(order_id)
        .map_err(ProcessOrderError::Repository)?
        .ok_or(ProcessOrderError::NotFound(order_id))?;

    let processed = calculate_order_total(&order);
    orders
        .save(&processed)
        .map_err(ProcessOrderError::Repository)?;

    Ok(processed)
}
`;
}

function adapter(domainPath, portPath) {
  return `use std::collections::HashMap;
use std::convert::Infallible;

use ${domainPath}::{Order, OrderId};
use ${portPath}::OrderRepository;

#[derive(Debug, Default)]
pub struct InMemoryOrderRepository {
    orders: HashMap<OrderId, Order>,
}

impl InMemoryOrderRepository {
    #[must_use]
    pub fn new(initial_orders: impl IntoIterator<Item = Order>) -> Self {
        let orders = initial_orders
            .into_iter()
            .map(|order| (order.id, order))
            .collect();
        Self { orders }
    }

    #[must_use]
    pub fn stored(&self, id: OrderId) -> Option<&Order> {
        self.orders.get(&id)
    }
}

impl OrderRepository for InMemoryOrderRepository {
    type Error = Infallible;

    fn find_by_id(&self, id: OrderId) -> Result<Option<Order>, Self::Error> {
        Ok(self.orders.get(&id).cloned())
    }

    fn save(&mut self, order: &Order) -> Result<(), Self::Error> {
        self.orders.insert(order.id, order.clone());
        Ok(())
    }
}
`;
}

function main(crateName, imports) {
  return `use ${crateName}${imports.application}::process_order;
use ${crateName}${imports.adapter}::InMemoryOrderRepository;
use ${crateName}${imports.domain}::{Order, OrderId};

fn main() {
    let mut orders = InMemoryOrderRepository::new([Order {
        id: OrderId(1),
        subtotal_cents: 10_000,
        total_cents: 0,
        customer_is_premium: true,
    }]);

    let processed = process_order(&mut orders, OrderId(1)).expect("order should exist");
    println!("Processed {:?}: {} cents", processed.id, processed.total_cents);
}
`;
}

function integrationTest(crateName, imports) {
  return `use ${crateName}${imports.application}::process_order;
use ${crateName}${imports.adapter}::InMemoryOrderRepository;
use ${crateName}${imports.domain}::{calculate_order_total, Order, OrderId};

#[test]
fn premium_orders_receive_ten_percent_discount() {
    let order = Order {
        id: OrderId(1),
        subtotal_cents: 10_000,
        total_cents: 0,
        customer_is_premium: true,
    };

    let processed = calculate_order_total(&order);

    assert_eq!(processed.total_cents, 9_000);
    assert_eq!(order.total_cents, 0);
}

#[test]
fn process_order_persists_the_calculated_total() {
    let mut repository = InMemoryOrderRepository::new([Order {
        id: OrderId(1),
        subtotal_cents: 10_000,
        total_cents: 0,
        customer_is_premium: true,
    }]);

    process_order(&mut repository, OrderId(1)).expect("processing should succeed");

    assert_eq!(
        repository.stored(OrderId(1)).map(|order| order.total_cents),
        Some(9_000)
    );
}
`;
}

function functionalFiles(crateName) {
  const imports = {
    domain: "::orders::domain",
    application: "::orders::application",
    adapter: "::orders::adapters",
  };
  return {
    "src/lib.rs": "pub mod orders;\n",
    "src/orders/mod.rs": "pub mod adapters;\npub mod application;\npub mod domain;\npub mod ports;\n",
    "src/orders/domain.rs": domain,
    "src/orders/ports.rs": port("crate::orders::domain"),
    "src/orders/application.rs": application(
      "crate::orders::domain",
      "crate::orders::ports",
    ),
    "src/orders/adapters.rs": adapter("crate::orders::domain", "crate::orders::ports"),
    "src/main.rs": main(crateName, imports),
    "tests/process_order.rs": integrationTest(crateName, imports),
  };
}

function cleanFiles(crateName) {
  const imports = {
    domain: "::domain::order",
    application: "::application::use_cases::process_order",
    adapter: "::infrastructure::in_memory_order_repository",
  };
  return {
    "src/lib.rs": "pub mod application;\npub mod domain;\npub mod infrastructure;\n",
    "src/domain/mod.rs": "pub mod order;\n",
    "src/domain/order.rs": domain,
    "src/application/mod.rs": "pub mod ports;\npub mod use_cases;\n",
    "src/application/ports/mod.rs": "pub mod order_repository;\n",
    "src/application/ports/order_repository.rs": port("crate::domain::order"),
    "src/application/use_cases/mod.rs": "pub mod process_order;\n",
    "src/application/use_cases/process_order.rs": application(
      "crate::domain::order",
      "crate::application::ports::order_repository",
    ),
    "src/infrastructure/mod.rs": "pub mod in_memory_order_repository;\n",
    "src/infrastructure/in_memory_order_repository.rs": adapter(
      "crate::domain::order",
      "crate::application::ports::order_repository",
    ),
    "src/main.rs": main(crateName, imports),
    "tests/process_order.rs": integrationTest(crateName, imports),
  };
}

function simpleFiles(crateName) {
  const simpleModule = `use std::collections::HashMap;
use std::convert::Infallible;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct OrderId(pub u64);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: OrderId,
    pub subtotal_cents: u64,
    pub total_cents: u64,
    pub customer_is_premium: bool,
}

#[must_use]
pub const fn calculate_discount_cents(
    subtotal_cents: u64,
    customer_is_premium: bool,
) -> u64 {
    if customer_is_premium {
        subtotal_cents / 10
    } else {
        0
    }
}

#[must_use]
pub fn calculate_order_total(order: &Order) -> Order {
    let discount_cents =
        calculate_discount_cents(order.subtotal_cents, order.customer_is_premium);
    Order {
        total_cents: order.subtotal_cents - discount_cents,
        ..order.clone()
    }
}

pub trait OrderRepository {
    type Error;

    fn find_by_id(&self, id: OrderId) -> Result<Option<Order>, Self::Error>;
    fn save(&mut self, order: &Order) -> Result<(), Self::Error>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProcessOrderError<E> {
    NotFound(OrderId),
    Repository(E),
}

pub fn process_order<R>(
    orders: &mut R,
    order_id: OrderId,
) -> Result<Order, ProcessOrderError<R::Error>>
where
    R: OrderRepository,
{
    let order = orders
        .find_by_id(order_id)
        .map_err(ProcessOrderError::Repository)?
        .ok_or(ProcessOrderError::NotFound(order_id))?;
    let processed = calculate_order_total(&order);
    orders
        .save(&processed)
        .map_err(ProcessOrderError::Repository)?;
    Ok(processed)
}

#[derive(Debug, Default)]
pub struct InMemoryOrderRepository {
    orders: HashMap<OrderId, Order>,
}

impl InMemoryOrderRepository {
    #[must_use]
    pub fn new(initial_orders: impl IntoIterator<Item = Order>) -> Self {
        let orders = initial_orders
            .into_iter()
            .map(|order| (order.id, order))
            .collect();
        Self { orders }
    }

    #[must_use]
    pub fn stored(&self, id: OrderId) -> Option<&Order> {
        self.orders.get(&id)
    }
}

impl OrderRepository for InMemoryOrderRepository {
    type Error = Infallible;

    fn find_by_id(&self, id: OrderId) -> Result<Option<Order>, Self::Error> {
        Ok(self.orders.get(&id).cloned())
    }

    fn save(&mut self, order: &Order) -> Result<(), Self::Error> {
        self.orders.insert(order.id, order.clone());
        Ok(())
    }
}
`;
  const imports = { domain: "::order", application: "::order", adapter: "::order" };
  return {
    "src/lib.rs": "pub mod order;\n",
    "src/order.rs": simpleModule,
    "src/main.rs": main(crateName, imports),
    "tests/order.rs": integrationTest(crateName, imports),
  };
}

export function rustScaffold({ crateName, style }) {
  const styleFiles = {
    simple: simpleFiles,
    "functional-core": functionalFiles,
    clean: cleanFiles,
  }[style](crateName);

  return {
    "Cargo.toml": cargoToml(crateName),
    "rustfmt.toml": 'edition = "2024"\n',
    ".gitignore": "/target\n.env\n.DS_Store\n",
    ...styleFiles,
  };
}

export function rustStructure(style) {
  if (style === "simple") return `src/\n├── lib.rs\n├── main.rs\n└── order.rs\ntests/`;
  if (style === "clean") {
    return `src/\n├── domain/\n├── application/\n│   ├── ports/\n│   └── use_cases/\n├── infrastructure/\n├── lib.rs\n└── main.rs\ntests/`;
  }
  return `src/\n├── orders/\n│   ├── domain.rs\n│   ├── application.rs\n│   ├── ports.rs\n│   └── adapters.rs\n├── lib.rs\n└── main.rs\ntests/`;
}

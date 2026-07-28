# Behavior tests

A strong test names a capability, enters through a public seam, uses production code paths, and observes a caller-visible result. It survives internal refactoring.

A weak test mocks internal collaborators, asserts private calls, or queries storage directly when the public API could verify the result.

## Example

```typescript
// Strong: public behavior
const order = await checkout(cart, paymentMethod)
expect(await getOrder(order.id)).toMatchObject({ status: "confirmed" })

// Weak: internal implementation detail
expect(paymentService.process).toHaveBeenCalledTimes(1)
```

# TypeScript — Advanced Patterns for Lead/Architect Interviews

> Cross-link: [JavaScript concepts](../javascript-concepts.txt) · [React advanced topics](../react/advanced-topics.md) · [Redux notes](../react/redux.md)
>
> Audience: senior engineers who already know `string | number`, interfaces, and basic generics. This note covers what gets asked in architect-level interviews — type system mechanics, library-author patterns, and production trade-offs.

---

## 1. Why TypeScript at architect level

At staff/lead level, TypeScript questions go beyond "what is `any`?" — they test whether you can:

1. **Encode invariants** in types so wrong code becomes uncompilable (not just unlikely).
2. **Build library-grade APIs** with good DX (autocomplete, inference, helpful errors).
3. **Trade off** type safety vs build time vs developer cognitive load.

The biggest mindset shift: **types are a programming language**. You can compute, branch, recurse, and produce new types from existing types.

---

## 2. Generics — the deep end

### 2.1 Generic constraints (`extends`)

```ts
// Without constraint — T could be anything, can't access .length
function lengthOf<T>(x: T) {
  return x.length; //  Property 'length' does not exist on type 'T'.
}

// With constraint — T must have .length
function lengthOf<T extends { length: number }>(x: T): number {
  return x.length;
}
lengthOf("hello");          // ok, string has length
lengthOf([1, 2, 3]);        // ok, array has length
lengthOf({ length: 5 });    // ok
lengthOf(42);               //  Argument of type 'number' is not assignable
```

### 2.2 Default type parameters

```ts
interface ApiResponse<TData = unknown, TError = Error> {
  data?: TData;
  error?: TError;
  status: "idle" | "loading" | "success" | "error";
}

const r1: ApiResponse = { status: "idle" };                  // TData=unknown
const r2: ApiResponse<FundNAV> = { status: "success", data: navRow }; // typed
```

### 2.3 Multiple type parameters with relationships

```ts
// Map a Record<K, V> to Record<K, U> — key relationship is enforced
function mapValues<K extends string, V, U>(
  obj: Record<K, V>,
  fn: (v: V, k: K) => U
): Record<K, U> {
  const out = {} as Record<K, U>;
  for (const k in obj) out[k] = fn(obj[k], k);
  return out;
}

// Citi CWO example — transform fund-NAV row into display row
const navs = { fundA: 102.5, fundB: 88.1, fundC: 145.0 };
const formatted = mapValues(navs, (v) => `$${v.toFixed(2)}`);
// type: Record<"fundA" | "fundB" | "fundC", string>
```

### 2.4 The `infer` keyword — extracting types

`infer` lets you pull a type out of a generic position. Used everywhere in utility types.

```ts
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
type Awaited<T>    = T extends Promise<infer U> ? U : T;
type First<T>      = T extends [infer H, ...any[]] ? H : never;

// Real example: extract response type from a React Query hook
type QueryData<T> = T extends { data: infer D } ? D : never;

function useNAVQuery() {
  return { data: [] as FundNAV[], isLoading: false };
}
type NAVList = QueryData<ReturnType<typeof useNAVQuery>>;  // FundNAV[]
```

---

## 3. Utility types — what they do and how they're built

Memorize these — interviewers ask "implement Pick yourself" or "what does Parameters<typeof fn> do?"

### 3.1 Built-in utility types

| Utility | Purpose | Built from |
|---------|---------|------------|
| `Partial<T>` | All props optional | mapped + `?` modifier |
| `Required<T>` | All props required | mapped + `-?` modifier |
| `Readonly<T>` | All props readonly | mapped + `readonly` modifier |
| `Pick<T, K>` | Subset of keys K | mapped type with `K extends keyof T` |
| `Omit<T, K>` | All keys except K | `Pick<T, Exclude<keyof T, K>>` |
| `Record<K, V>` | Object with K keys → V values | mapped type |
| `Exclude<T, U>` | T minus U | conditional + distributive |
| `Extract<T, U>` | T intersect U | conditional + distributive |
| `NonNullable<T>` | Remove null/undefined | `Exclude<T, null \| undefined>` |
| `ReturnType<F>` | Return type of function | conditional + `infer` |
| `Parameters<F>` | Param tuple of function | conditional + `infer` |
| `Awaited<T>` | Unwrap Promise (recursive) | conditional + `infer` |

### 3.2 Implementing them yourself (interview classic)

```ts
type MyPartial<T>    = { [K in keyof T]?: T[K] };
type MyRequired<T>   = { [K in keyof T]-?: T[K] };
type MyReadonly<T>   = { readonly [K in keyof T]: T[K] };
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyOmit<T, K extends keyof any> = MyPick<T, Exclude<keyof T, K>>;
type MyExclude<T, U> = T extends U ? never : T;
type MyExtract<T, U> = T extends U ? T : never;
type MyReturnType<T> = T extends (...a: any[]) => infer R ? R : never;
```

The trick most candidates miss: **`Omit<T, K>` allows any string for K** (`K extends keyof any`), not just keys of T. That's intentional — it allows omitting keys that "may not exist". Strict variant:

```ts
type StrictOmit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
```

---

## 4. Conditional types

`T extends U ? X : Y` — type-level if/else.

```ts
type IsString<T> = T extends string ? true : false;
type A = IsString<"hi">;   // true
type B = IsString<42>;     // false
```

### 4.1 Distributive conditional types

When the checked type is a **bare type parameter** and the input is a **union**, the conditional distributes over each member:

```ts
type ToArray<T> = T extends any ? T[] : never;
type X = ToArray<string | number>;   //  string[] | number[]  (distributed!)

// To prevent distribution, wrap in tuple
type ToArrayNoDist<T> = [T] extends [any] ? T[] : never;
type Y = ToArrayNoDist<string | number>;  // (string | number)[]
```

**Why this matters:** `Exclude` and `Extract` only work because of distribution.

```ts
type Exclude<T, U> = T extends U ? never : T;
type R = Exclude<"a" | "b" | "c", "b">;   // "a" | "c"
// Distributes: ("a" extends "b" ? never : "a") | ("b" extends "b" ? ...) | ...
```

### 4.2 Real use case — typed API response narrowing

```ts
type ApiResult<T> =
  | { status: "success"; data: T }
  | { status: "error"; error: string };

type DataOf<R> = R extends { status: "success"; data: infer D } ? D : never;

const res: ApiResult<FundNAV[]> = await fetchNAV();
if (res.status === "success") {
  res.data; //  FundNAV[]
}
// Or extract:
type T = DataOf<ApiResult<FundNAV[]>>; // FundNAV[]
```

---

## 5. Mapped types

Iterate over keys of a type to produce a new type.

```ts
type Optional<T> = { [K in keyof T]?: T[K] };

// Key remapping with `as` (TS 4.1+)
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
};

interface User { name: string; age: number; }
type UserGetters = Getters<User>;
// { getName: () => string; getAge: () => number; }
```

### 5.1 Modifiers `+` `-` `?` `readonly`

```ts
type Mutable<T>     = { -readonly [K in keyof T]: T[K] };
type Required2<T>   = { [K in keyof T]-?: T[K] };
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K]
};
```

### 5.2 Practical: form-state mapper

Verizon dashboard example — derive a form-state shape from a domain model:

```ts
interface OrderDraft {
  orderId: string;
  amount: number;
  notes?: string;
}

type FormState<T> = {
  [K in keyof T]: { value: T[K]; touched: boolean; error?: string }
};

type OrderForm = FormState<OrderDraft>;
// { orderId: {value: string, touched: boolean, error?}, amount: {...}, notes: {...} }
```

---

## 6. Template literal types

String-level computation in the type system.

```ts
type Greet<T extends string> = `Hello, ${T}!`;
type Hi = Greet<"Indrasis">;   // "Hello, Indrasis!"

// Event-name builder
type EventName<T extends string> = `on${Capitalize<T>}`;
type ClickEvent = EventName<"click">;  // "onClick"

// CSS variable builder
type CSSVar<T extends string> = `--${T}`;
type C = CSSVar<"primary-color">;  // "--primary-color"
```

### 6.1 Parsing strings at type level

```ts
type Split<S extends string, D extends string> =
  S extends `${infer H}${D}${infer T}` ? [H, ...Split<T, D>] : [S];

type Parts = Split<"a.b.c.d", ".">;  // ["a", "b", "c", "d"]
```

### 6.2 Typed routing (Next.js / React Router)

```ts
type ExtractRouteParams<T extends string> =
  T extends `${string}/:${infer P}/${infer R}` ? P | ExtractRouteParams<`/${R}`> :
  T extends `${string}/:${infer P}`           ? P :
  never;

type P = ExtractRouteParams<"/users/:userId/orders/:orderId">;
// "userId" | "orderId"
```

---

## 7. Discriminated unions — the workhorse pattern

Use a literal "tag" to enable type narrowing.

```ts
type LoadingState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

function render<T>(s: LoadingState<T>) {
  switch (s.status) {
    case "idle":    return null;
    case "loading": return <Spinner />;
    case "success": return <View data={s.data} />;    // narrowed
    case "error":   return <Error msg={s.error.message} />;
  }
}
```

**Exhaustiveness check** — catch missing cases at compile time:

```ts
function render2<T>(s: LoadingState<T>) {
  switch (s.status) {
    case "idle":    return null;
    case "loading": return <Spinner />;
    case "success": return <View data={s.data} />;
    case "error":   return <Error msg={s.error.message} />;
    default: {
      const _exhaustive: never = s;  // errors if new variant added
      return _exhaustive;
    }
  }
}
```

This is **the** pattern for Redux action types, state machines, parser ASTs, RAG response types.

---

## 8. Branded / nominal types

TypeScript is structurally typed — two types with the same shape are compatible. Sometimes you want nominal typing (e.g., `UserId` shouldn't be assignable to `OrderId`).

```ts
type Brand<T, B> = T & { __brand: B };

type UserId  = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

function asUserId(s: string): UserId { return s as UserId; }
function asOrderId(s: string): OrderId { return s as OrderId; }

function getUser(id: UserId) { /* ... */ }

const u = asUserId("u_123");
const o = asOrderId("o_999");
getUser(u);    // ok
getUser(o);    //  Argument of type 'OrderId' is not assignable to 'UserId'
getUser("raw"); //  primitive string also rejected
```

**Citi CWO use case:** `FundId`, `NavValue`, `AccountId` all underlying `string`/`number` — branding prevents accidentally passing a fund id where account id is expected.

---

## 9. Type guards & type predicates

Runtime checks that *teach* the compiler.

```ts
// User-defined type guard
function isFundNAV(x: unknown): x is FundNAV {
  return typeof x === "object"
      && x !== null
      && "fundId" in x
      && "nav" in x
      && typeof (x as any).nav === "number";
}

const raw: unknown = JSON.parse(payload);
if (isFundNAV(raw)) {
  raw.nav.toFixed(2);  // narrowed to FundNAV
}
```

### 9.1 `asserts` keyword (assertion functions)

```ts
function assertDefined<T>(v: T | undefined, msg = "expected defined"): asserts v is T {
  if (v === undefined) throw new Error(msg);
}

const fund = funds.find(f => f.id === "F1");
assertDefined(fund);
fund.nav;  // narrowed to defined
```

### 9.2 Runtime + compile-time validation with Zod

For external boundaries (API responses, form input), pair type guards with a schema library:

```ts
import { z } from "zod";

const FundNAVSchema = z.object({
  fundId: z.string(),
  nav: z.number().positive(),
  asOfDate: z.string().datetime(),
});
type FundNAV = z.infer<typeof FundNAVSchema>;

const parsed = FundNAVSchema.parse(await res.json());
// parsed is typed AND runtime-validated
```

Architect insight: **types are erased at runtime** — for any data crossing a network/IO boundary, you need runtime validation. Don't trust the API contract.

---

## 10. Decorators (TS 5.0+ standard decorators)

Stage 3 ECMAScript decorators are now native (TS 5.0+). Different from legacy experimental decorators.

```ts
function log<This, Args extends any[], Return>(
  target: (this: This, ...args: Args) => Return,
  ctx: ClassMethodDecoratorContext
) {
  return function (this: This, ...args: Args): Return {
    console.log(`Calling ${String(ctx.name)}`, args);
    const result = target.call(this, ...args);
    console.log(`Returned`, result);
    return result;
  };
}

class NAVService {
  @log
  fetchNAV(fundId: string) {
    return fetch(`/api/funds/${fundId}/nav`).then(r => r.json());
  }
}
```

**When to use:** observability (logging, tracing), validation, RBAC checks, deprecation marking. **When NOT to use:** simple cross-cutting concerns where a HOF wrapper is clearer.

---

## 11. Declaration merging

Augment existing types — useful for theming, custom matchers, module augmentation.

```ts
// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; roles: string[] };
    }
  }
}

// Add custom Jest matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinNAVRange(min: number, max: number): R;
    }
  }
}

// Extend window
declare global {
  interface Window {
    __APP_CONFIG__: { apiUrl: string };
  }
}
```

---

## 12. Variance (covariance, contravariance, invariance)

Senior interviewers ask: "Why does this assignment fail?"

```ts
type Animal = { name: string };
type Dog    = Animal & { breed: string };

// Arrays are covariant in TS (read-only direction)
let animals: Animal[] = [];
let dogs: Dog[] = [{ name: "Rex", breed: "Lab" }];
animals = dogs;   // ok — Dog[] is a subtype of Animal[]
// (TS is lenient here — Java/Scala would also flag the write-back hazard)

// Functions are contravariant in their parameters
type Handler<T> = (x: T) => void;
let handleAnimal: Handler<Animal>;
let handleDog: Handler<Dog>;
handleDog = handleAnimal;   // ok — handler that accepts any Animal can handle a Dog
handleAnimal = handleDog;   //  handler expecting Dog can't handle any Animal
```

**`strictFunctionTypes: true`** enforces contravariance for function params (recommended). Without it, TS uses bivariance for method syntax (the historical default — looser).

---

## 13. Type-level testing

For library code, write tests that fail to compile if types regress.

```ts
type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

// Tests
type _t1 = Expect<Equal<Pick<{a:1,b:2}, "a">, {a:1}>>;
type _t2 = Expect<Equal<ReturnType<() => string>, string>>;
```

Tools: [`tsd`](https://github.com/SamVerschueren/tsd), [`expect-type`](https://github.com/mmkal/expect-type).

---

## 14. Performance & build-time concerns (architect lens)

| Concern | Symptom | Fix |
|---------|---------|-----|
| Slow tsc | >30s incremental build | `incremental: true`, project references, `skipLibCheck: true` |
| `any` proliferation | Tooling autocomplete dies | Lint rule `@typescript-eslint/no-explicit-any` |
| Deep generic recursion | TS2589 "Type instantiation is excessively deep" | Cap recursion depth; convert to iterative where possible |
| `tsc --build` vs `tsc` | Slow monorepo | Use **project references** with composite projects |
| `isolatedModules` issues | Babel/SWC strip type-only imports incorrectly | Use `import type` everywhere |
| Type-only imports | Cyclic ESM at runtime | `import type { Foo } from './foo'` — erased at runtime |

### `tsconfig.json` essentials for production

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "incremental": true
  }
}
```

`noUncheckedIndexedAccess`: `arr[0]` becomes `T | undefined`. Catches a huge class of runtime errors. Recommended for new projects, painful for legacy migration.

---

## 15. React + TypeScript patterns

### 15.1 Typing hooks

```ts
// Generic state with discriminated result
function useApiQuery<T>(url: string): LoadingState<T> { /* ... */ }

const q = useApiQuery<FundNAV[]>("/api/nav");
if (q.status === "success") q.data.map(/* ... */);
```

### 15.2 Polymorphic `as` prop

A reusable Button that renders any element:

```ts
type Props<E extends React.ElementType> = {
  as?: E;
  variant?: "primary" | "secondary";
} & React.ComponentPropsWithoutRef<E>;

function Button<E extends React.ElementType = "button">({
  as, variant = "primary", ...rest
}: Props<E>) {
  const Comp = as ?? "button";
  return <Comp className={`btn-${variant}`} {...rest} />;
}

<Button>Save</Button>                                    // button
<Button as="a" href="/x">Link</Button>                   // a, href required
<Button as={Link} to="/x">RouterLink</Button>            // RR Link
```

### 15.3 Strongly-typed Redux Toolkit slice (Verizon dashboard)

```ts
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface OrderState {
  byId: Record<string, Order>;
  filter: "all" | "open" | "closed";
}

const initial: OrderState = { byId: {}, filter: "all" };

const orderSlice = createSlice({
  name: "orders",
  initialState: initial,
  reducers: {
    upsert(state, action: PayloadAction<Order>) {
      state.byId[action.payload.id] = action.payload;
    },
    setFilter(state, action: PayloadAction<OrderState["filter"]>) {
      state.filter = action.payload;
    },
  },
});

// Typed dispatch + selector
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "./store";
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

### 15.4 Typed React Query (Citi CWO fund NAV)

```ts
function useFundNAV(fundId: FundId) {
  return useQuery({
    queryKey: ["nav", fundId] as const,
    queryFn: async ({ queryKey }): Promise<FundNAV> => {
      const [, id] = queryKey;
      const res = await fetch(`/api/funds/${id}/nav`);
      return FundNAVSchema.parse(await res.json());
    },
    staleTime: 60_000,
  });
}
```

---

## 16. Interview talking points

**Q: When would you NOT use TypeScript?**
- Throwaway prototypes / one-off scripts
- Teams without TS muscle (cost > benefit short-term)
- Heavy meta-programming workloads where TS adds friction (rare)

**Q: How do you handle `any` in a large codebase?**
- Lint rule for new code (`no-explicit-any`)
- Use `unknown` at boundaries + narrow with type guards / Zod
- Tech-debt ticket for legacy `any` islands, prioritize high-traffic modules

**Q: TypeScript vs Flow vs JSDoc-with-types?**
- TS won the ecosystem race. Flow dead. JSDoc-types viable for small libs (no build step) but loses on advanced patterns and DX.

**Q: How do you keep type errors actionable for the team?**
- `strict: true` from day 1 (much harder to add later)
- `tsc --noEmit` in CI as a separate step from build
- IDE config shared (`.vscode/settings.json`) for consistent diagnostics

**Q: Trade-off — runtime validation everywhere vs only at boundaries?**
- Only at boundaries (Network, IO, user input, env vars). Internal code trusts the type system. Over-validation kills performance and obscures intent.

---

## 17. Further reading

- [TypeScript Deep Dive (Basarat)](https://basarat.gitbook.io/typescript/) — community classic
- [type-challenges](https://github.com/type-challenges/type-challenges) — practice problems
- [Effective TypeScript (Vanderkam)](https://effectivetypescript.com/) — 62 specific items
- TS handbook → 2.0+ release notes (each version adds features worth knowing)

---

## Appendix: cheat-sheet of inferences

```ts
type Keys<T>          = keyof T;
type Values<T>        = T[keyof T];
type ElementOf<A>     = A extends (infer E)[] ? E : never;
type PromiseValue<P>  = P extends Promise<infer V> ? V : P;
type FuncArgs<F>      = F extends (...a: infer A) => any ? A : never;
type FuncReturn<F>    = F extends (...a: any[]) => infer R ? R : never;
type InstanceOf<C>    = C extends new (...a: any) => infer I ? I : never;
type LastOf<U>        = ((U extends any ? (k: () => U) => void : never) extends (k: infer L) => void
                          ? (L extends () => infer R ? R : never) : never);  // last item of union
```

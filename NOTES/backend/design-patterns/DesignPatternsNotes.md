# Frontend & React Design Patterns

---

## Common JavaScript / Frontend Design Patterns

### 1. Singleton

Ensures a class or object has only one instance and provides a global point of access to it.

**How it works in ESM:**
In the ES Module system, the first time a file is imported, the result is cached. Every subsequent import returns the exact same memory reference — making module-level exports natural singletons.

**Drawbacks:**
- Hard to test — the shared instance must be reset manually before each test
- Lives outside React's lifecycle, so it won't trigger re-renders when data changes

**Use when:** UI updates are not needed.

**Frontend example:** A configured Axios instance shared across the app.

```js
// apiClient.js
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

export default apiClient; // same instance reused everywhere
```

**Node.js examples:** Database connection, config loader, logger.

---

### 2. Factory

A Factory function or component decides *which* object or component to create, rather than hardcoding the `new` keyword or conditionals everywhere.

**Benefits:**
- Decoupling — consumers don't need to know which concrete class is used
- Scalability — adding a new variant only requires updating the factory file
- Satisfies the Open/Closed Principle (open for extension, closed for modification) and Liskov Substitution Principle

**Frontend example:** Rendering different form field types from a config.

```js
// FieldFactory.jsx
const FieldFactory = ({ type, ...props }) => {
  const fields = { text: TextInput, select: SelectInput, checkbox: Checkbox };
  const Component = fields[type] ?? TextInput;
  return <Component {...props} />;
};
```

**Node.js example:** `NotificationFactory` that returns an `EmailNotifier` or `SMSNotifier` based on user preference.

---

### 3. Observer

Many listeners react to a change in one source.

- **Subject** — holds the state/data and notifies observers on change
- **Observer** — receives the notification and reacts

**In React:** State or a store (e.g. Zustand, Redux) is the subject; components subscribed to it are the observers.

**Frontend example:** A global toast/notification system where multiple components subscribe to an event emitter.

```js
// eventBus.js (subject)
const listeners = {};
export const subscribe = (event, cb) => { listeners[event] = [...(listeners[event] || []), cb]; };
export const publish  = (event, data) => { (listeners[event] || []).forEach(cb => cb(data)); };

// usage in a component (observer)
useEffect(() => {
  subscribe('ORDER_PLACED', showToast);
}, []);
```

**Libraries:** RxJS, `react-observable`.

**Node.js example:** Node's built-in `EventEmitter`; message queues; push notifications.

---

### 4. Strategy

Enables selecting an algorithm or behavior at runtime. Instead of large `if/else` or `switch` blocks, each behavior is encapsulated in its own function and chosen dynamically.

**Frontend example:** Swappable sort strategies in a data table.

```js
const strategies = {
  price_asc:  (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
  name_asc:   (a, b) => a.name.localeCompare(b.name),
};

const sortedProducts = [...products].sort(strategies[selectedSort]);
```

**Node.js example:** Passport.js — pluggable authentication strategies (Google, Facebook, Local). The main app flow stays unchanged; only the strategy is swapped.

---

### 5. Adapter

Transforms data from one interface (e.g. an API response) into the shape that components expect, without touching either side.

**Implementation:** A lightweight mapping function, typically co-located with the API service.

**Frontend example:** Normalising a third-party API response before it reaches your components.

```js
// userAdapter.js
export const adaptUser = (raw) => ({
  id:        raw.user_id,
  fullName:  `${raw.first_name} ${raw.last_name}`,
  avatarUrl: raw.profile_picture_url,
});

// userService.js
export const fetchUser = async (id) => {
  const { data } = await apiClient.get(`/users/${id}`);
  return adaptUser(data);
};
```

> For small-to-medium apps the adapter can live directly in the service file. Extract to its own file as the mapping logic grows.

**Node.js example:** Prisma acts as an adapter — you write standard JS/TS, and Prisma translates it to the correct SQL dialect (PostgreSQL, MySQL, SQLite).

---

### 6. Façade

Provides a simple, unified interface over complex or scattered logic.

**Frontend example:** A single `useCheckout` hook that hides cart, payment, and shipping concerns from the UI.

```js
// useCheckout.js (facade)
export const useCheckout = () => {
  const { cart, clearCart } = useCart();
  const { processPayment } = usePayment();
  const { calculateShipping } = useShipping();

  const placeOrder = async () => {
    const shipping = calculateShipping(cart);
    await processPayment({ cart, shipping });
    clearCart();
  };

  return { placeOrder };
};
```

**Node.js example:** A Backend for Frontend (BFF) layer that fans out to five microservices (orders, inventory, user, payment, shipping) and returns a single clean JSON response to the client.

---

### 7. Decorator

Adds behaviour to a function or component *without* modifying the original.

**Frontend examples:**
- **HOC** — wraps a component to inject auth, feature-flag, or analytics logic
- **Function wrapper** — adds logging or permission checks around a handler

```js
// withPermission.jsx (decorator HOC)
const withPermission = (WrappedComponent, requiredRole) => (props) => {
  const { user } = useAuth();
  if (!user.roles.includes(requiredRole)) return <AccessDenied />;
  return <WrappedComponent {...props} />;
};

export default withPermission(AdminPanel, 'admin');
```

**Node.js example:** Express middleware (logging, rate limiting, auth) decorates route handlers without changing them.

---

### 8. Proxy

Controls access to an object, or adds logic *before* the real object is interacted with.

**Frontend examples:**
- Axios interceptors — transparently attach auth headers, handle token refresh, or normalise errors
- A caching or validation layer in front of an API call

```js
// Axios interceptor acting as a proxy
apiClient.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${getToken()}`;
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) redirectToLogin();
    return Promise.reject(err);
  }
);
```

**Node.js examples:** ES6 `Proxy` object for validation/access control; API gateway rate limiting; cache-aside patterns.

---

---

## React Design Patterns

### 1. Custom Hooks

Enable logic reuse through functional composition.

**Benefits:**
- Cleaner than nested HOCs — no wrapper hell
- No risk of prop name conflicts
- Works naturally with Suspense and the `use()` hook (React 19)

**When to use HOC instead:** Error Boundaries, Auth Guards, Feature Flags — cases where you genuinely need to wrap a component tree.

**Example — composing three hooks vs. three nested HOCs:**

```js
// ✅ Hooks approach — flat, readable
const Dashboard = () => {
  const { user }  = useAuth();
  const { theme } = useTheme();
  const { data }  = useDashboardData(user.id);
  // ...
};

// ❌ HOC approach — three levels of nesting, potential prop conflicts
export default withAuth(withTheme(withDashboardData(Dashboard)));
```

---

### 2. Compound Components

Breaks a large component into closely related sub-components that share implicit state via Context.

**Rules:**
- Sub-components only make sense *in the context of* the parent — don't import and use them independently
- Parent creates the context and holds shared state; sub-components consume it via `useContext`

**Use cases:** Tabs, Accordion, Modal (used in libraries like Material UI, Radix UI, Headless UI).

```jsx
// Usage
<Tabs defaultValue="profile">
  <Tabs.List>
    <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
    <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="profile"><ProfileView /></Tabs.Panel>
  <Tabs.Panel value="settings"><SettingsView /></Tabs.Panel>
</Tabs>
```

```js
// Parent — creates context, holds state
const TabsContext = createContext();

const Tabs = ({ defaultValue, children }) => {
  const [active, setActive] = useState(defaultValue);
  return (
    <TabsContext.Provider value={{ active, setActive }}>
      {children}
    </TabsContext.Provider>
  );
};

// Sub-component — reads shared state
Tabs.Panel = ({ value, children }) => {
  const { active } = useContext(TabsContext);
  return active === value ? <div>{children}</div> : null;
};
```

---

### 3. Container / Presentational

Separates *what to render* (presentational) from *how to get the data* (container).

| Concern | Layer |
|---|---|
| Fetching data, state, business logic | Container / custom hook |
| Receiving props, rendering UI | Presentational component |

**Modern approach:** Replace the container component with a custom hook, and call it inside the presentational component for small-to-medium components.

```
Legacy:  UserContainer.jsx  +  UserList.jsx
Modern:  useUsersData.jsx   +  UserList.jsx  (hook called inside UserList)
```

**Use cases:** User list/table/card, Dashboard widgets (chart UI + data fetching logic).

---

### 4. HOC (Higher-Order Component)

A function that takes a component as an argument and returns a new enhanced component.

**Common use cases:** Auth guards, feature flags, error boundaries, analytics tracking.

**Known gotcha — static properties are lost:**

```js
class UserPage extends React.Component {
  static fetchData() { /* used for SSR or routing */ }
}

export default withAuth(UserPage);

UserPage.fetchData // ❌ undefined — HOC doesn't inherit statics
```

**Fix:**

```js
import hoistNonReactStatics from 'hoist-non-react-statics';

const HOC = (WrappedComponent) => {
  const Enhanced = (props) => <WrappedComponent {...props} />;
  hoistNonReactStatics(Enhanced, WrappedComponent); // ✅ copies statics
  return Enhanced;
};
```

> In React 19, custom hooks cover ~90% of HOC use cases with less complexity.

---

### 5. Render Props

The value of a prop is a function that returns JSX. The parent component controls *when* to call it and what data to pass.

**Drawbacks:**
- Nested structure can make JSX hard to read ("callback hell" in templates)
- A new function is created on every render (use `useCallback` if needed)

**Use case:** Older form libraries like Formik used this pattern extensively before hooks.

```jsx
<Formik initialValues={{ email: '' }} onSubmit={handleSubmit}>
  {({ values, handleChange }) => (
    <form>
      <input name="email" value={values.email} onChange={handleChange} />
    </form>
  )}
</Formik>
```

> Prefer custom hooks over render props in new code — same power, cleaner syntax.

---

### 6. Slot Pattern

When child components share no state with each other, pass them as props (slots) rather than using Compound Components or Render Props.

**Use case:** Layout components like `Card`, `PageLayout`, `Modal` where you just need to inject content into named regions.

```jsx
<Card
  header={<h4>Order Summary</h4>}
  content={<OrderItemList items={items} />}
  footer={<Button onClick={checkout}>Place Order</Button>}
/>
```

```js
// Card.jsx
const Card = ({ header, content, footer }) => (
  <div className="card">
    <div className="card__header">{header}</div>
    <div className="card__body">{content}</div>
    <div className="card__footer">{footer}</div>
  </div>
);
```

**When to use Slot vs Compound Components:**

| | Slot | Compound |
|---|---|---|
| Sub-components share state | ❌ | ✅ |
| Sub-components are layout-only | ✅ | ❌ |
| Example | Card, PageLayout | Tabs, Accordion |
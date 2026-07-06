# SOLID Principles — React & Node.js (Interview Notes)

---

## 1. Single Responsibility Principle (SRP)
**A module/component/class should have only one reason to change.**

### React example
Instead of one `ProductsPage` doing search, filtering, and rendering:
```jsx
// ❌ One component, three reasons to change (search UX, grid layout, data logic)
function ProductsPage() {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  useEffect(() => { fetchProducts(query).then(setProducts); }, [query]);
  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <div className="grid">
        {products.map(p => <div key={p.id}>{p.name}</div>)}
      </div>
    </div>
  );
}

// ✅ Split by responsibility
<ProductSearch onSearch={setQuery} />
<ProductGrid products={products} />
```
Search UI, grid rendering, and data-fetching each change for a different reason and business owner — they should live separately.

### Node.js example
```js
// ❌ Everything in the route handler
app.post('/users', async (req, res) => {
  if (!req.body.email) return res.status(400).send('Email required');
  const hashed = await bcrypt.hash(req.body.password, 10);
  const user = await db.collection('users').insertOne({ ...req.body, password: hashed });
  res.json(user);
});

// ✅ Split into layers
app.post('/users', validateUser, userController.create);

// validators/userValidator.js
const validateUser = (req, res, next) => {
  if (!req.body.email) return res.status(400).send('Email required');
  next();
};

// services/userService.js
class UserService {
  async createUser(data) {
    const hashed = await bcrypt.hash(data.password, 10);
    return db.collection('users').insertOne({ ...data, password: hashed });
  }
}

// controllers/userController.js
const create = async (req, res) => {
  const user = await userService.createUser(req.body);
  res.json(user);
};
```
Validation, business logic, and HTTP handling are separated — a change to hashing logic never touches routing code.

---

## 2. Open/Closed Principle (OCP)
**Open for extension, closed for modification.**

### React example
```jsx
// ✅ Button is extensible via composition — never needs internal edits
function Button({ children, ...props }) {
  return <button className="btn" {...props}>{children}</button>;
}

// Extending without touching Button.jsx
<Button><i className="fa fa-lock" /> Disable</Button>
<Button><Spinner /> Loading...</Button>
```
Every new visual variant (icon, spinner, badge) is added by the *consumer*, not by editing `Button`.

### Node.js example
Adding Google OAuth to an existing local-auth flow without touching the login controller — classic **Strategy pattern** application of OCP:
```js
// passport-config.js
passport.use('local', new LocalStrategy(localVerify));
passport.use('google', new GoogleStrategy(googleConfig, googleVerify));

// auth.controller.js — never edited when a new provider is added
app.post('/login/:provider', (req, res, next) => {
  passport.authenticate(req.params.provider)(req, res, next);
});
```
Adding Facebook login later = register a new strategy. `auth.controller.js` stays untouched.

---

## 3. Liskov Substitution Principle (LSP)
**Subtypes must be substitutable for their base type without breaking the caller.**

### React example
```jsx
// All field types honor the same contract: { value, onChange }
const TextField = ({ value, onChange }) => <input value={value} onChange={onChange} />;
const CheckboxField = ({ value, onChange }) => <input type="checkbox" checked={value} onChange={onChange} />;
const TextareaField = ({ value, onChange }) => <textarea value={value} onChange={onChange} />;

// Form doesn't care which field it renders — all are interchangeable
function FormField({ Component, value, onChange }) {
  return <Component value={value} onChange={onChange} />;
}
```
**A real violation:** a `ReadOnlyInput` that ignores `onChange` or throws when it fires — any form that maps over fields and calls `onChange` blindly will break. Fix: give read-only fields a separate, honest contract instead of forcing them into the same interface.

### Node.js example
```js
// Both DB adapters honor the exact same contract
class MongoDB {
  async connect(uri) { /* ... */ return this; }
  async findUser(id) { return this.collection('users').findOne({ _id: id }); }
}
class PostgresDB {
  async connect(uri) { /* ... */ return this; }
  async findUser(id) { return this.query('SELECT * FROM users WHERE id=$1', [id]); }
}

// Service layer works with either, unaware of which one is injected
class UserRepository {
  constructor(db) { this.db = db; } // db: MongoDB | PostgresDB
  getUser(id) { return this.db.findUser(id); }
}
```
If `PostgresDB.findUser()` returned a different shape (e.g., raw SQL rows vs a normalized object) without adapting it, callers relying on the Mongo shape would break — an LSP violation.

---

## 4. Interface Segregation Principle (ISP)
**Don't force a consumer to depend on things it doesn't use.**

### React example
```jsx
// ❌ Avatar forced to accept unrelated props
<Avatar image={user.imgUrl} name={user.name} onClick={openProfile} />

// ✅ Only what it actually needs
<Avatar src={user.avatarUrl} />
```
If `Avatar` only renders an image, it shouldn't require `name` or `onClick` — those belong to a wrapping component (`<UserCard>`) that composes `Avatar` with a click handler and label.

### Node.js example
```js
// ❌ One fat service, most consumers use 2 of 10 methods
class UserService {
  createUser() {}
  deleteUser() {}
  updateProfile() {}
  sendPasswordReset() {}
  generateInvoice() {}
  exportUserReport() {}
  // ...
}

// ✅ Split by concern — consumers depend only on what they need
class UserAccountService { createUser() {}; deleteUser() {}; updateProfile() {} }
class UserAuthService { sendPasswordReset() {} }
class UserBillingService { generateInvoice() {}; exportUserReport() {} }
```
The billing cron job now imports `UserBillingService` only — it has zero coupling to auth or profile logic, so a change there can't break billing.

---

## 5. Dependency Inversion Principle (DIP)
**High-level modules shouldn't depend on low-level modules — both depend on abstractions.**

### React example
```jsx
// ❌ Component directly coupled to axios/fetch implementation
function UserProfile({ id }) {
  const [user, setUser] = useState(null);
  useEffect(() => { axios.get(`/api/users/${id}`).then(res => setUser(res.data)); }, [id]);
  return <div>{user?.name}</div>;
}

// ✅ Component depends on an abstraction (a service/hook), not the HTTP client
// userService.js
export const userService = {
  getUser: (id) => axios.get(`/api/users/${id}`).then(res => res.data),
};

function UserProfile({ id }) {
  const [user, setUser] = useState(null);
  useEffect(() => { userService.getUser(id).then(setUser); }, [id]);
  return <div>{user?.name}</div>;
}
```
Swapping axios for `fetch`, or mocking the service in tests, never touches `UserProfile`.

### Node.js example
```js
// ❌ UserService hard-coded to Sendgrid
class UserService {
  async register(data) {
    const user = await db.save(data);
    await sendgrid.send({ to: user.email, template: 'welcome' }); // tight coupling
    return user;
  }
}

// ✅ Depend on an EmailService abstraction, inject the concrete implementation
class EmailService {
  constructor(provider) { this.provider = provider; } // provider: SendgridProvider | SesProvider
  send(to, template) { return this.provider.send(to, template); }
}

class UserService {
  constructor(emailService) { this.emailService = emailService; } // injected
  async register(data) {
    const user = await db.save(data);
    await this.emailService.send(user.email, 'welcome');
    return user;
  }
}

const userService = new UserService(new EmailService(new SendgridProvider()));
```
Switching from Sendgrid to AWS SES later = swap the provider passed in, `UserService` never changes.

---

## DRY (bonus, often asked alongside SOLID)

| Type | React example | Node example |
|---|---|---|
| **Components** | Same button style used in 5 places → extract `<Button />` | N/A |
| **Logic (hooks)** | 3 components check auth → extract `useAuth()` | Repeated permission checks → extract `checkPermission()` middleware |
| **Utilities** | `formatCurrency()` duplicated → move to `utils/` | Repeated date formatting → shared `utils/dateHelpers.js` |
| **Services** | Multiple components call the API directly → central `userService.js` | Multiple controllers build SQL manually → central `UserRepository` |

---

## Cross-Questions & How to Answer

**Q1: "Doesn't splitting everything into tiny components/functions hurt readability and add overhead?"**
> SRP is about *reasons to change*, not line count. A 300-line component with one responsibility (e.g., a complex chart) is fine. A 30-line component that fetches data, validates it, and renders UI is not — because three different stakeholders can each force a change to it. I split along **change axes**, not arbitrary size limits.

**Q2: "Open/Closed sounds nice in theory — how do you keep 'extending without modifying' from turning into endless prop drilling or a giant switch statement?"**
> I use composition (children, render props, slots) for UI extension, and Strategy/plugin registries for behavior extension (e.g., auth providers, payment methods). If I notice a switch statement growing every sprint, that's my signal to convert it into a registry pattern — new cases get *registered*, not *inserted into existing code*.

**Q3: "Give me a real Liskov Substitution violation you've seen or fixed."**
> A `ReadOnlyInput` component reused inside a generic form-field mapper that assumed every field fires `onChange`. It didn't, so bulk-edit logic silently skipped read-only fields, causing a data sync bug. Fix: gave read-only fields an explicit separate contract instead of forcing conformance to the editable-field interface.

**Q4: "Isn't Interface Segregation just Single Responsibility again?"**
> They're related but distinct. SRP is about *why a component/class changes*. ISP is about *what a consumer is forced to depend on*. A component can have exactly one responsibility internally but still expose a fat interface (too many props/methods) that most callers don't need — that's an ISP violation independent of SRP.

**Q5: "Doesn't Dependency Inversion (services, DI) add unnecessary complexity for a small app or a quick script?"**
> Yes — I don't apply it everywhere. DIP pays off when (a) the concrete implementation is genuinely likely to change (payment gateway, email provider, DB), or (b) I need to mock it in unit tests. For a one-off script or a component that will never swap its data source, direct imports are simpler and that's fine. Over-applying DIP is itself a smell.

**Q6: "How do SOLID principles map differently between a functional React codebase and a class-based Node/OOP codebase?"**
> The intent is identical — manage change and coupling — but the mechanism differs. React (functional) achieves SOLID mostly through **composition, hooks, and props**; Node/OOP backends achieve it through **classes, interfaces, and dependency injection**. E.g., DIP in React looks like "depend on a service module," while in Node it often looks like "inject a concrete class implementing a shared interface."

**Q7: "Which SOLID principle do you find gets violated most often in real codebases, and why?"**
> SRP and DIP, in my experience — SRP because deadlines push people to add "just one more thing" to an existing component/controller, and DIP because it's easy to reach for a concrete import (axios, Sendgrid, a specific DB driver) directly instead of writing the abstraction, especially early in a project. The cost shows up later when that dependency needs to change or be mocked in tests.

**One-liner to close the topic:** *"SOLID principles are heuristics for managing the cost of future change — I apply them where that cost is high, and I don't over-engineer where it isn't."*
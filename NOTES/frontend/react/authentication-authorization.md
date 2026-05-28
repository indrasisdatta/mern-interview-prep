# React — Authentication & Authorization

// In Route, "replace" is used when user explicitly didn't click to navigate 
// Used in post login, post logout redirects  
// replace ultimately calls the browser replaceState() which overrides the current history instead of creating new one 

// navigate("/login"); -> window.history.pushState(state, "", "/login")
// navigate("/login", {replace: true}) -> window.history.replaceState(state, "", "/login)

// routeAccess.ts - URL allowed w.r.t claims
export const ROUTE_ACCESS = {
  "/dashboard": ["dashboard:view"],
  "/settings": ["settings:edit"],
  "/products": ["products:view"],
  "/products/edit": ["products:edit"],
};

// Routing code 
<BrowserRouter>
    <Routes>
        <Route path="/terms" element={<TermsConditions /> } />
        <Route path="/auth" element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/products">
                <Route path="" index element={<ProductList />} />
                <Route path="/edit/:productId" element={<ProductEdit />} />
            </Route>            
        </Route>
    </Routes>
</BrowserRouter>

// ProtectedRoute.tsx 

export const ProtectedRoute = ({ children }) => {
    const { user } = useAuth();
    const location = useLocation();

    if (!user) return <Navigate path="/login" replace state={{ from: location }} />

    const location = useLocation();

    // ["dashboard:view", "dashboard:edit"]
    const isAllowed = ROUTE_ACCESS[location?.pathname].every(p => user?.claims.includes(p));

    if (!isAllowed) return <p>Unauthorized access!</p>

    return <Outlet />
}    

// Login component - redirect to previously accessed page form the state
export const Login = () => {
    const navigate = useNavigation();
    const location = useLocation();

    const from = location.state?.from?.pathname || '/dashboard';

    const handleLogn = () => {
        // API call
        return navigate(from, { replace: true }) // Redirect code
    }
}
 
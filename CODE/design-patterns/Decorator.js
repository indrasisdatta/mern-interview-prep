/* Example 1: Protected route  */
const ProtectedPage = ({ role, children }) => {
    const navigate = useNavigate();
    const { isAuthenticated, userRole } = useAuth();
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }
    if (role && !userRole.includes(role)) { 
        return <p>Unauthorized access</p> 
    }
    return <>{children}</>
}

// Route logic - add Protected wrapper
<Routes>    
    <Route 
        path="/profile" 
        element={
        <ProtectedPage role="admin">
            <Profile />
        </ProtectedPage>
    } />
    <Route 
        path="/dashboard" 
        element={
        <ProtectedPage role="admin">
            <Dashboard />
        </ProtectedPage>
    } />
</Routes>

/* Example 2: Error boundaries using HOC */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    componentDidCatch(error, errorInfo) {
        console.error();
    }
    static getDerivedStateFromError() {
        return { hasError : true };
    }
    render() {
        if (this.state.hasError) {
            return this.props.fallback || "Something went wrong";
        }
        return this.props.children;
    }
}

// HOC
const withErrorBoundary = (Component, FallbackError) => {
    return (props) => (
        <ErrorBoundary fallback={FallbackError}>
            <Component {...props} />
        </ErrorBoundary>
    )
}

// Using HOC
const Dashboard = () => { return 'Dashboard' };
const DashboardPage = withErrorBoundary(Dashboard, <p>Error loading Dashboard</p>);

function App() {
    return (
        <>
            <DashboardPage />
        </>
    )
}

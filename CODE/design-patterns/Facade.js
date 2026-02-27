// Messy way 
function ProductPage({ productId }) {
  const { user } = useAuth();
  const { data: product, loading } = useFetchProduct(productId);
  const { trackEvent } = useAnalytics();

  const handleBuy = () => {
    trackEvent('PURCHASE_ATTEMPT', { id: productId });
    // Imagine more complex logic here...
  };

  if (loading) return <Loader />;
  return <button onClick={handleBuy}>Buy {product.name}</button>;
}

// Using Facade 
// useProductDetailsFacade.js
export function useProductDetailsFacade(productId) {
  const { user } = useAuth();
  const { data: product, loading } = useFetchProduct(productId);
  const { trackEvent } = useAnalytics();

  const canEdit = user?.roles.includes('admin');
  
  const purchase = () => {
    trackEvent('PURCHASE_ATTEMPT', { id: productId });
    // Handle API call, toast notifications, etc.
  };

  return { product, loading, canEdit, purchase };
}

// ProductPage.jsx
function ProductPage({ productId }) {
  // The component is now clean and focused only on the UI
  const { product, loading, canEdit, purchase } = useProductDetailsFacade(productId);

  if (loading) return <Loader />;
  return <button onClick={purchase}>Buy {product.name}</button>;
} 

// A custom hook usually does one thing (like fetching data). 
// A Facade composes multiple hooks together to provide a simplified API for a specific feature
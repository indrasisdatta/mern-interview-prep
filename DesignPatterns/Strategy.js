// Refactor this code
{isLoading ? 
    <Loader /> : 
    (isError ? 
        <Error /> : 
        userData.length ? 0 ? 
        <UsersList users={usersData} /> : <p>No data</p> 
    )
}
// New code 
const RenderStrategy = {
  loading: () => <Loader />,
  error: () => <Error />,
  empty: () => <p>No data found.</p>,
  success: (data) => <UsersList users={data} />,
};
const getStatus = (isLoading, isError, data) => {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (!data || data.length === 0) return 'empty';
  return 'success';
};
return {RenderStrategy[status](userData)}
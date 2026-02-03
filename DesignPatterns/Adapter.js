// Adapter function
function adaptUser(apiUser) {
  return {
    id: apiUser.user_id,
    name: apiUser.user_name,
    email: apiUser.email_address
  };
}

// Service function
export async function getUser(id) {
  const res = await api.get(`/users/${id}`);
  return adaptUser(res.data);
}
import { Navigate, Outlet, useLocation } from 'react-router';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useAuth } from './authContext';

/**
 * Route wrapper: renders child routes only for signed-in users. Users still on
 * an admin-issued temporary password are held on the change-password page.
 */
export default function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'initializing') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress aria-label="Restoring your session" />
      </Box>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }
  if (user?.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

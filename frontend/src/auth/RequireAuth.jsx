import { Navigate, Outlet, useLocation } from 'react-router';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useAuth } from './authContext';

/** Route wrapper: renders child routes only for signed-in users. */
export default function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'initializing') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress aria-label="Restoring your session" />
      </Box>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

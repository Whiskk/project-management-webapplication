import { Link as RouterLink, Outlet } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAuth } from './authContext';
import { can } from './permissions';

/** Route wrapper: renders child routes only if the user has `permission`. */
export default function RequirePermission({ permission }) {
  const { user } = useAuth();
  if (can(user, permission)) return <Outlet />;
  return (
    <Stack spacing={2} alignItems="flex-start">
      <Typography variant="h1">Access denied</Typography>
      <Alert severity="warning">You do not have permission to view this page.</Alert>
      <Button variant="contained" component={RouterLink} to="/">
        Back to dashboard
      </Button>
    </Stack>
  );
}

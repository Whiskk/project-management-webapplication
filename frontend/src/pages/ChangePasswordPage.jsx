import { Navigate, useNavigate } from 'react-router';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAuth } from '../auth/authContext';
import ChangePasswordForm from '../components/auth/ChangePasswordForm';
import BrandMark from '../components/layout/BrandMark';
import { useNotify } from '../components/feedback/notificationContext';

/**
 * Shown after signing in with a temporary password issued by an admin (new
 * account or reset). Nothing else is reachable until a new password is chosen;
 * the API enforces the same rule.
 */
export default function ChangePasswordPage() {
  const { user, updateUser, logout } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();

  if (!user?.must_change_password) return <Navigate to="/" replace />;

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default', backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(76, 142, 224, 0.22), transparent 70%), radial-gradient(ellipse 50% 40% at 90% 110%, rgba(43, 179, 181, 0.12), transparent 70%)' }}>
      <Card sx={{ width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2.5}>
            <div>
              <BrandMark size={40} />
              <Typography variant="h1" gutterBottom sx={{ mt: 2 }}>Choose a new password</Typography>
              <Typography color="text.secondary">
                Welcome, {user.first_name}. You signed in with a temporary password from an administrator.
                Choose your own password to continue.
              </Typography>
            </div>
            <ChangePasswordForm
              currentLabel="Temporary password"
              submitLabel="Set password and continue"
              onChanged={(updated) => {
                updateUser({ must_change_password: updated.must_change_password });
                notify('Password changed. Welcome to Project Hub!', 'success');
                navigate('/', { replace: true });
              }}
            />
            <Button onClick={logout} sx={{ alignSelf: 'flex-start' }}>Sign out</Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

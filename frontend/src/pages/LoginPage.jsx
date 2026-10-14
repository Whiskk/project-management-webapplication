import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import BrandMark from '../components/layout/BrandMark';
import { useAuth } from '../auth/authContext';

function validate({ employeeId, password }) {
  const errors = {};
  if (!employeeId.trim()) errors.employeeId = 'Employee ID is required';
  if (!password) errors.password = 'Password is required';
  return errors;
}

export default function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ employeeId: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Always land on the dashboard: the previous page may belong to a different
  // user (e.g. an admin-only page from before sign-out) that this user cannot see.
  if (status === 'authenticated') return <Navigate to="/" replace />;

  const handleChange = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await login(values.employeeId.trim(), values.password);
      navigate('/', { replace: true });
    } catch (error) {
      setSubmitError(error.message);
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default', backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(76, 142, 224, 0.22), transparent 70%), radial-gradient(ellipse 50% 40% at 90% 110%, rgba(43, 179, 181, 0.12), transparent 70%)' }}>
      <Card sx={{ width: '100%', maxWidth: 420, boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack component="form" spacing={2.5} onSubmit={handleSubmit} noValidate>
            <div>
              <BrandMark size={40} />
              <Typography variant="h1" gutterBottom sx={{ mt: 2 }}>
                Project Hub
              </Typography>
              <Typography color="text.secondary">Sign in with your employee ID.</Typography>
            </div>
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <TextField
              label="Employee ID"
              value={values.employeeId}
              onChange={handleChange('employeeId')}
              error={Boolean(fieldErrors.employeeId)}
              helperText={fieldErrors.employeeId}
              autoComplete="username"
              autoFocus
              required
              disabled={submitting}
            />
            <TextField
              label="Password"
              type="password"
              value={values.password}
              onChange={handleChange('password')}
              error={Boolean(fieldErrors.password)}
              helperText={fieldErrors.password}
              autoComplete="current-password"
              required
              disabled={submitting}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : null}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

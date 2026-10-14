import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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

/** Left half of the sign-in screen (desktop only): the product name and what it is for. */
function ProductPanel() {
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        p: 6,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: '#0e1627',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <BrandMark />
        <Typography variant="h6" component="span">Project Hub</Typography>
      </Stack>

      {/* The headline sits in the vertical middle of the panel, under the logo. */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 480, mx: 'auto', width: '100%' }}>
        <Typography component="p" sx={{ fontSize: { md: '2.25rem', lg: '2.75rem' }, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.025em' }}>
          Project management made easy.
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          Projects, people and budgets in one place.
        </Typography>
      </Box>
    </Box>
  );
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
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, bgcolor: 'background.default' }}>
      <ProductPanel />

      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 3, sm: 6 } }}>
        <Stack component="form" spacing={2.5} onSubmit={handleSubmit} noValidate sx={{ width: '100%', maxWidth: 380 }}>
          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ display: { md: 'none' }, mb: 2 }}>
            <BrandMark />
            <Typography variant="h6" component="span">Project Hub</Typography>
          </Stack>
          <div>
            <Typography variant="h1" gutterBottom>Welcome back</Typography>
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
          <Typography variant="body2" color="text.secondary">
            No account yet? Accounts are created by an administrator.
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

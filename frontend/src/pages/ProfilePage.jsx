import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useAuth } from '../auth/authContext';
import { ROLE_LABELS } from '../auth/permissions';
import { useNotify } from '../components/feedback/notificationContext';
import { usersApi } from '../services/usersApi';
import { fieldErrorsFrom } from '../utils/format';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function ReadOnlyField({ label, value }) {
  return (
    <div>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography>{value || '—'}</Typography>
    </div>
  );
}

/** The signed-in user's profile. Everyone may edit their own name and email only. */
export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const notify = useNotify();
  const [values, setValues] = useState({ first_name: user.first_name, last_name: user.last_name, email: user.email });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const changed = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([key, value]) => value !== user[key]),
  );
  const isDirty = Object.keys(changed).length > 0;

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationErrors = {};
    if (!values.first_name.trim()) validationErrors.first_name = 'First name is required';
    if (!values.last_name.trim()) validationErrors.last_name = 'Last name is required';
    if (!EMAIL_RE.test(values.email.trim())) validationErrors.email = 'Enter a valid email address';
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;

    setSaving(true);
    setSubmitError(null);
    try {
      const updated = await usersApi.updateMe(changed);
      updateUser({ first_name: updated.first_name, last_name: updated.last_name, email: updated.email });
      setValues({ first_name: updated.first_name, last_name: updated.last_name, email: updated.email });
      notify('Profile updated', 'success');
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setSubmitError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const fieldProps = (field) => ({
    value: values[field],
    onChange: setField(field),
    error: Boolean(errors[field]),
    helperText: errors[field],
    disabled: saving,
    fullWidth: true,
    required: true,
  });

  return (
    <Stack spacing={3}>
      <Typography variant="h1">My profile</Typography>
      <Card sx={{ maxWidth: 720 }}>
        <CardContent>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, sm: 4 }}><ReadOnlyField label="Employee ID" value={user.employee_id} /></Grid>
            <Grid size={{ xs: 6, sm: 4 }}><ReadOnlyField label="Role" value={ROLE_LABELS[user.role]} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><ReadOnlyField label="Job title" value={user.job_title} /></Grid>
          </Grid>
          <Divider sx={{ mb: 3 }} />
          <Stack component="form" spacing={2} onSubmit={handleSubmit} noValidate>
            <Typography variant="h3" component="h2">Personal details</Typography>
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="First name" {...fieldProps('first_name')} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="Last name" {...fieldProps('last_name')} /></Grid>
              <Grid size={12}><TextField label="Email" type="email" {...fieldProps('email')} /></Grid>
            </Grid>
            <Typography variant="body2" color="text.secondary">
              Other details such as your job title or manager can only be changed by an administrator.
            </Typography>
            <div>
              <Button type="submit" variant="contained" disabled={!isDirty || saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

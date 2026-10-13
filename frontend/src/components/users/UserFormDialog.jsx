import { useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useMediaQuery } from 'react-responsive';
import { ROLE_LABELS } from '../../auth/permissions';
import useApiResource from '../../hooks/useApiResource';
import { usersApi } from '../../services/usersApi';
import { fieldErrorsFrom, fullName } from '../../utils/format';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMPTY = { first_name: '', last_name: '', email: '', job_title: '', role: 'employee', salary: '', manager_id: '' };

function initialValues(user) {
  if (!user) return EMPTY;
  return {
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    job_title: user.job_title ?? '',
    role: user.role,
    salary: user.salary ?? '',
    manager_id: user.manager_id ?? '',
  };
}

function validate(values, isAdmin) {
  const errors = {};
  if (!values.first_name.trim()) errors.first_name = 'First name is required';
  if (!values.last_name.trim()) errors.last_name = 'Last name is required';
  if (!EMAIL_RE.test(values.email.trim())) errors.email = 'Enter a valid email address';
  if (isAdmin) {
    if (values.salary === '' || Number(values.salary) < 0) errors.salary = 'Enter an annual salary of 0 or more';
    if (values.role === 'employee' && !values.manager_id) errors.manager_id = 'Employees must have a manager';
  }
  return errors;
}

/** Build the request payload: all fields for create, only changed fields for edit. */
function buildPayload(values, user, isAdmin) {
  const payload = {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    email: values.email.trim(),
    job_title: values.job_title.trim(),
  };
  if (isAdmin) {
    payload.role = values.role;
    payload.salary = Number(values.salary);
    payload.manager_id = values.role === 'employee' ? Number(values.manager_id) : null;
  }
  if (!user) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => (user[key] ?? '') !== value));
}

/**
 * Create or edit a user.
 *
 * Admins edit every field; managers edit basic details of their direct reports.
 * Calls `onSaved(result)` with the API response after a successful save.
 */
export default function UserFormDialog({ open, user, editorRole, onClose, onSaved }) {
  const isAdmin = editorRole === 'admin';
  const fullScreen = useMediaQuery({ maxWidth: 599 });
  const [values, setValues] = useState(() => initialValues(user));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchManagers = useCallback(
    (signal) => (isAdmin ? usersApi.list({ role: 'manager', page_size: 100 }, signal) : Promise.resolve({ items: [] })),
    [isAdmin],
  );
  const managers = useApiResource(fetchManagers);

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationErrors = validate(values, isAdmin);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;

    const payload = buildPayload(values, user, isAdmin);
    if (user && Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const result = user ? await usersApi.update(user.id, payload) : await usersApi.create(payload);
      onSaved(result);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setSubmitError(error.message);
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
  });

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>{user ? `Edit ${fullName(user)}` : 'New user'}</DialogTitle>
        <DialogContent>
          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="First name" required autoFocus {...fieldProps('first_name')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Last name" required {...fieldProps('last_name')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Email" type="email" required {...fieldProps('email')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Job title" {...fieldProps('job_title')} />
            </Grid>
            {isAdmin && (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField select label="Role" required {...fieldProps('role')}>
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>{label}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Annual salary"
                    type="number"
                    required
                    slotProps={{
                      input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                      htmlInput: { min: 0, step: 1000 },
                    }}
                    {...fieldProps('salary')}
                  />
                </Grid>
                {values.role === 'employee' && (
                  <Grid size={12}>
                    <TextField
                      select
                      label="Manager"
                      required
                      {...fieldProps('manager_id')}
                      helperText={errors.manager_id || (managers.status === 'error' ? 'Could not load managers' : undefined)}
                    >
                      {(managers.data?.items ?? []).map((manager) => (
                        <MenuItem key={manager.id} value={manager.id}>
                          {fullName(manager)} ({manager.employee_id})
                        </MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                )}
              </>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : user ? 'Save changes' : 'Create user'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

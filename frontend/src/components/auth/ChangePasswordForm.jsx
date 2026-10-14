import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from '../../services/api';
import { fieldErrorsFrom } from '../../utils/format';

const EMPTY = { current_password: '', new_password: '', confirm: '' };

/** Same rules as the server (pm_core.passwords.check_new_password), for instant feedback. */
function validate(values, currentLabel) {
  const errors = {};
  if (!values.current_password) errors.current_password = `Enter your ${currentLabel.toLowerCase()}`;
  const next = values.new_password;
  if (next.length < 8) errors.new_password = 'Must be at least 8 characters';
  else if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) errors.new_password = 'Must contain at least one letter and one number';
  else if (next === values.current_password) errors.new_password = 'Must be different from your current password';
  if (values.confirm !== next) errors.confirm = 'Passwords do not match';
  return errors;
}

/**
 * Change your own password. Used for the forced first-sign-in step and in My profile.
 * Calls `onChanged(user)` with the updated user after success.
 */
export default function ChangePasswordForm({ currentLabel = 'Current password', submitLabel = 'Change password', onChanged }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const found = validate(values, currentLabel);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const user = await api.post('auth', '/change-password', {
        current_password: values.current_password,
        new_password: values.new_password,
      });
      setValues(EMPTY);
      setSaving(false);
      onChanged(user);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setSubmitError(error.message);
      setSaving(false);
    }
  };

  const fieldProps = (field) => ({
    type: 'password',
    value: values[field],
    onChange: setField(field),
    error: Boolean(errors[field]),
    helperText: errors[field],
    disabled: saving,
    required: true,
    fullWidth: true,
  });

  return (
    // pt: room for the first field's floating label below a heading.
    // autoComplete "new-password" on every field: browsers must not pre-fill a
    // saved password here; the user has to type their current one deliberately.
    <Stack component="form" spacing={2} onSubmit={handleSubmit} noValidate autoComplete="off" sx={{ pt: 1 }}>
      {submitError && <Alert severity="error">{submitError}</Alert>}
      <TextField label={currentLabel} autoComplete="new-password" {...fieldProps('current_password')} />
      <TextField label="New password" autoComplete="new-password" {...fieldProps('new_password')} />
      <TextField label="Confirm new password" autoComplete="new-password" {...fieldProps('confirm')} />
      <Typography variant="body2" color="text.secondary">
        At least 8 characters, with at least one letter and one number.
      </Typography>
      <div>
        <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
      </div>
    </Stack>
  );
}

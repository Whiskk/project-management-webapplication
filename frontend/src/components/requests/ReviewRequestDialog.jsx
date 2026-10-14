import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useMediaQuery } from 'react-responsive';
import { projectsApi } from '../../services/projectsApi';
import { fieldErrorsFrom } from '../../utils/format';
import ManagerSelect from '../users/ManagerSelect';

/**
 * Admin decision on a project request.
 * `mode` is 'approve' (details can be adjusted; creates the project) or 'reject' (a reason is required).
 */
export default function ReviewRequestDialog({ request, mode, onClose, onDone }) {
  const approving = mode === 'approve';
  const fullScreen = useMediaQuery({ maxWidth: 599 });
  const [values, setValues] = useState({
    name: request.name,
    start_date: request.start_date,
    predicted_end_date: request.predicted_end_date,
    budget: String(request.budget),
    manager_id: request.requested_by,
    note: '',
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validate = () => {
    const found = {};
    if (approving) {
      if (!values.name.trim()) found.name = 'Project name is required';
      if (values.predicted_end_date < values.start_date) found.predicted_end_date = 'Must be on or after the start date';
      if (values.budget === '' || Number(values.budget) < 0) found.budget = 'Enter a budget of 0 or more';
      if (!values.manager_id) found.manager_id = 'Choose who will manage the project';
    } else if (!values.note.trim()) {
      found.note = 'Give a reason so the manager knows why';
    }
    return found;
  };

  /** Only send the details the admin actually changed. */
  const adjustments = () => {
    const proposed = {
      name: values.name.trim(),
      start_date: values.start_date,
      predicted_end_date: values.predicted_end_date,
      budget: Number(values.budget),
      manager_id: Number(values.manager_id),
    };
    const original = { ...request, manager_id: request.requested_by };
    return Object.fromEntries(Object.entries(proposed).filter(([key, value]) => value !== original[key]));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const result = approving
        ? await projectsApi.approveRequest(request.id, { ...adjustments(), ...(values.note.trim() ? { note: values.note.trim() } : {}) })
        : await projectsApi.rejectRequest(request.id, values.note.trim());
      onDone(result);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      if (error.details?.manager_id) setErrors((current) => ({ ...current, manager_id: error.details.manager_id }));
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
  const dateProps = { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>{approving ? `Approve '${request.name}'?` : `Reject '${request.name}'?`}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {approving
              ? 'The project is created as soon as you approve. You can adjust the details first.'
              : `${request.requested_by_name} will see your reason.`}
          </DialogContentText>
          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
          <Grid container spacing={2}>
            {approving && (
              <>
                <Grid size={12}><TextField label="Project name" required {...fieldProps('name')} /></Grid>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="Start date" {...dateProps} {...fieldProps('start_date')} /></Grid>
                <Grid size={{ xs: 12, sm: 6 }}><TextField label="Predicted end date" {...dateProps} {...fieldProps('predicted_end_date')} /></Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Budget"
                    type="number"
                    required
                    slotProps={{
                      input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                      htmlInput: { min: 0, step: 1000 },
                    }}
                    {...fieldProps('budget')}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <ManagerSelect
                    label="Project manager"
                    value={values.manager_id}
                    onChange={setField('manager_id')}
                    error={errors.manager_id}
                    disabled={saving}
                  />
                </Grid>
              </>
            )}
            <Grid size={12}>
              <TextField
                label={approving ? 'Note (optional)' : 'Reason'}
                required={!approving}
                multiline
                minRows={2}
                autoFocus={!approving}
                slotProps={{ htmlInput: { maxLength: 1000 } }}
                {...fieldProps('note')}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" color={approving ? 'primary' : 'error'} disabled={saving}>
            {saving ? 'Saving…' : approving ? 'Approve and create project' : 'Reject request'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

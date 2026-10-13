import { useState } from 'react';
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
import { projectsApi } from '../../services/projectsApi';
import { fieldErrorsFrom } from '../../utils/format';
import ManagerSelect from '../users/ManagerSelect';
import { PROJECT_STATUSES } from './projectStatuses';

const EMPTY = {
  name: '', description: '', start_date: '', predicted_end_date: '', budget: '', manager_id: '', status: 'planned',
};
// Fields a manager may edit on their own projects; admins may edit everything.
const MANAGER_FIELDS = ['description', 'start_date', 'predicted_end_date', 'budget', 'status'];

function initialValues(project) {
  if (!project) return EMPTY;
  return {
    name: project.name,
    description: project.description ?? '',
    start_date: project.start_date,
    predicted_end_date: project.predicted_end_date,
    budget: project.budget ?? '',
    manager_id: project.manager_id,
    status: project.status,
  };
}

function validate(values, isAdmin) {
  const errors = {};
  if (isAdmin && !values.name.trim()) errors.name = 'Project name is required';
  if (!values.start_date) errors.start_date = 'Start date is required';
  if (!values.predicted_end_date) errors.predicted_end_date = 'Predicted end date is required';
  else if (values.start_date && values.predicted_end_date < values.start_date) {
    errors.predicted_end_date = 'Must be on or after the start date';
  }
  if (values.budget === '' || Number(values.budget) < 0) errors.budget = 'Enter a budget of 0 or more';
  if (isAdmin && !values.manager_id) errors.manager_id = 'Every project needs a manager';
  return errors;
}

function buildPayload(values, project, isAdmin) {
  const all = {
    name: values.name.trim(),
    description: values.description.trim(),
    start_date: values.start_date,
    predicted_end_date: values.predicted_end_date,
    budget: Number(values.budget),
    manager_id: Number(values.manager_id),
    status: values.status,
  };
  const allowed = isAdmin ? Object.keys(all) : MANAGER_FIELDS;
  const payload = Object.fromEntries(allowed.map((key) => [key, all[key]]));
  if (!project) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => project[key] !== value));
}

/**
 * Create (admin) or edit a project.
 * Admins edit every field; managers edit the schedule, budget, status and description of their own projects.
 */
export default function ProjectFormDialog({ open, project, editorRole, onClose, onSaved }) {
  const isAdmin = editorRole === 'admin';
  const fullScreen = useMediaQuery({ maxWidth: 599 });
  const [values, setValues] = useState(() => initialValues(project));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationErrors = validate(values, isAdmin);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;

    const payload = buildPayload(values, project, isAdmin);
    if (project && Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const saved = project ? await projectsApi.update(project.id, payload) : await projectsApi.create(payload);
      onSaved(saved);
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
  const dateProps = { type: 'date', required: true, slotProps: { inputLabel: { shrink: true } } };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>{project ? `Edit ${project.name}` : 'New project'}</DialogTitle>
        <DialogContent>
          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            {isAdmin && (
              <Grid size={12}>
                <TextField label="Project name" required autoFocus {...fieldProps('name')} />
              </Grid>
            )}
            <Grid size={12}>
              <TextField label="Description" multiline minRows={3} {...fieldProps('description')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Start date" {...dateProps} {...fieldProps('start_date')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Predicted end date" {...dateProps} {...fieldProps('predicted_end_date')} />
            </Grid>
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
              <TextField select label="Status" {...fieldProps('status')}>
                {Object.entries(PROJECT_STATUSES).map(([value, { label }]) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            {isAdmin && (
              <Grid size={12}>
                <ManagerSelect
                  label="Project manager"
                  value={values.manager_id}
                  onChange={setField('manager_id')}
                  error={errors.manager_id}
                  disabled={saving}
                />
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

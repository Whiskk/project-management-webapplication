import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useMediaQuery } from 'react-responsive';
import { projectsApi } from '../../services/projectsApi';
import { fieldErrorsFrom, formatDate } from '../../utils/format';
import { MILESTONE_STATUSES } from './milestoneStatuses';

function initialValues(milestone) {
  return {
    title: milestone?.title ?? '',
    description: milestone?.description ?? '',
    start_date: milestone?.start_date ?? '',
    due_date: milestone?.due_date ?? '',
    status: milestone?.status ?? 'not_started',
    depends_on: milestone?.depends_on.map((d) => d.id) ?? [],
  };
}

/**
 * Create or edit a milestone. Mirrors the server's rules for instant feedback:
 * dates in order, starting after dependencies are due, and not starting work
 * before dependencies are completed. The server remains the source of truth.
 */
export default function MilestoneDialog({ project, milestone, milestones, onClose, onSaved }) {
  const fullScreen = useMediaQuery({ maxWidth: 599 });
  const [values, setValues] = useState(() => initialValues(milestone));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  // A milestone can't depend on itself (cycles are checked by the server).
  const candidates = milestones.filter((m) => m.id !== milestone?.id);
  const selectedDeps = candidates.filter((m) => values.depends_on.includes(m.id));
  const latestDependency = selectedDeps.reduce((latest, m) => (!latest || m.due_date > latest.due_date ? m : latest), null);

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validate = () => {
    const found = {};
    if (!values.title.trim()) found.title = 'Title is required';
    if (!values.start_date) found.start_date = 'Start date is required';
    else if (values.start_date < project.start_date) found.start_date = `Must be on or after the project start (${formatDate(project.start_date)})`;
    else if (latestDependency && values.start_date < latestDependency.due_date) {
      found.start_date = `Must be on or after ${formatDate(latestDependency.due_date)}, when '${latestDependency.title}' is due`;
    }
    if (!values.due_date) found.due_date = 'Due date is required';
    else if (values.start_date && values.due_date < values.start_date) found.due_date = 'Must be on or after the start date';
    const incomplete = selectedDeps.filter((m) => m.status !== 'completed');
    if (['in_progress', 'completed'].includes(values.status) && incomplete.length) {
      found.status = `Waiting on: ${incomplete.map((m) => m.title).join(', ')}`;
    }
    return found;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    const payload = { ...values, title: values.title.trim(), description: values.description.trim() };
    setSaving(true);
    setSubmitError(null);
    try {
      const saved = milestone
        ? await projectsApi.updateMilestone(project.id, milestone.id, payload)
        : await projectsApi.createMilestone(project.id, payload);
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
    <Dialog open onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>{milestone ? `Edit ${milestone.title}` : 'New milestone'}</DialogTitle>
        <DialogContent>
          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={12}>
              <TextField label="Title" required autoFocus {...fieldProps('title')} />
            </Grid>
            <Grid size={12}>
              <TextField label="Description" multiline minRows={2} {...fieldProps('description')} />
            </Grid>
            <Grid size={12}>
              <Autocomplete
                multiple
                options={candidates}
                value={selectedDeps}
                onChange={(_event, chosen) => {
                  setValues((current) => ({ ...current, depends_on: chosen.map((m) => m.id) }));
                  setErrors((current) => ({ ...current, depends_on: undefined, start_date: undefined, status: undefined }));
                }}
                getOptionLabel={(option) => `${option.title} (due ${formatDate(option.due_date)})`}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                disabled={saving}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Depends on"
                    error={Boolean(errors.depends_on)}
                    helperText={errors.depends_on || 'This milestone starts after these are due, and can only be worked on once they are completed'}
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Start date" {...dateProps} {...fieldProps('start_date')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Due date" {...dateProps} {...fieldProps('due_date')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField select label="Status" {...fieldProps('status')}>
                {Object.entries(MILESTONE_STATUSES).map(([value, { label }]) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
          {values.due_date && values.due_date > project.predicted_end_date && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              This is due after the project's predicted end ({formatDate(project.predicted_end_date)}). It will be flagged as a schedule risk.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : milestone ? 'Save changes' : 'Add milestone'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

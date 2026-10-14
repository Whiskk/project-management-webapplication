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

const EMPTY = { name: '', description: '', start_date: '', predicted_end_date: '', budget: '', justification: '' };

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Project name is required';
  if (!values.start_date) errors.start_date = 'Start date is required';
  if (!values.predicted_end_date) errors.predicted_end_date = 'Predicted end date is required';
  else if (values.start_date && values.predicted_end_date < values.start_date) {
    errors.predicted_end_date = 'Must be on or after the start date';
  }
  if (values.budget === '' || Number(values.budget) < 0) errors.budget = 'Enter a budget of 0 or more';
  if (!values.justification.trim()) errors.justification = 'Explain why this project is needed';
  return errors;
}

/** A manager asks an admin for a new project, which they will manage if approved. */
export default function RequestFormDialog({ onClose, onSubmitted }) {
  const fullScreen = useMediaQuery({ maxWidth: 599 });
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
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const saved = await projectsApi.submitRequest({
        name: values.name.trim(),
        description: values.description.trim(),
        start_date: values.start_date,
        predicted_end_date: values.predicted_end_date,
        budget: Number(values.budget),
        justification: values.justification.trim(),
      });
      onSubmitted(saved);
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
        <DialogTitle>Request a new project</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            An admin reviews your request. If it is approved, the project is created with you as its manager.
          </DialogContentText>
          {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}
          <Grid container spacing={2}>
            <Grid size={12}><TextField label="Project name" required autoFocus {...fieldProps('name')} /></Grid>
            <Grid size={12}><TextField label="Description" multiline minRows={2} {...fieldProps('description')} /></Grid>
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
            <Grid size={12}>
              <TextField label="Justification" required multiline minRows={3} {...fieldProps('justification')} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Sending…' : 'Submit request'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

import { useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import useApiResource from '../../hooks/useApiResource';
import { projectsApi } from '../../services/projectsApi';
import { fieldErrorsFrom, formatCurrency, formatHours, fullName } from '../../utils/format';

const MAX_HOURS = 40;

function PreviewRow({ label, value, tone }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600} color={tone}>{value}</Typography>
    </Stack>
  );
}

/**
 * Assign an employee to a project, or change an existing assignment's hours.
 *
 * Shows live availability (40-hour rule) and cost against the remaining budget,
 * and blocks saving when either rule would be broken. The API enforces the same
 * rules, so its message is shown if anything changed in the meantime.
 */
export default function AssignmentDialog({ project, assignment, onClose, onSaved }) {
  const editing = Boolean(assignment);
  const fetchOptions = useCallback((signal) => projectsApi.staffingOptions(project.id, signal), [project.id]);
  const options = useApiResource(fetchOptions);

  const [selectedId, setSelectedId] = useState(assignment?.user_id ?? null);
  // Edits start from the reserved figure (what the budget and 40-hour rule currently count).
  const [hours, setHours] = useState(assignment ? String(assignment.reserved_hours) : '');
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [saving, setSaving] = useState(false);

  const allOptions = options.data?.items ?? [];
  const choices = editing ? allOptions : allOptions.filter((option) => option.assignment_id === null);
  const selected = allOptions.find((option) => option.user_id === selectedId) ?? null;

  const newHours = Number(hours) || 0;
  const oldHours = assignment ? Number(assignment.reserved_hours) : 0;
  const confirmedHours = assignment?.hours_per_week ?? 0;
  // Someone else's report: new hours, or more than the confirmed hours, wait for their manager.
  const needsApproval = Boolean(selected?.needs_approval)
    && (!editing || assignment.status === 'pending' || newHours > Number(confirmedHours));
  const delta = newHours - oldHours;
  const addedCost = selected ? delta * selected.cost_per_weekly_hour : 0;
  const costAfter = Number(project.projected_cost) + addedCost;
  const remainingAfter = Number(project.budget) - costAfter;

  const overHours = selected && newHours > Number(selected.available_hours);
  const overBudget = delta > 0 && remainingAfter < -0.005;
  const invalidHours = hours !== '' && (newHours < 0.5 || newHours > MAX_HOURS);
  const canSave = selected && hours !== '' && !invalidHours && !overHours && !overBudget && delta !== 0 && !saving;

  const handleSave = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setFieldError(null);
    try {
      const result = editing
        ? await projectsApi.updateAssignment(project.id, assignment.id, { hours_per_week: newHours })
        : await projectsApi.assign(project.id, { user_id: selected.user_id, hours_per_week: newHours });
      onSaved(selected, result);
    } catch (apiError) {
      setFieldError(fieldErrorsFrom(apiError).hours_per_week ?? apiError.details?.hours_per_week ?? null);
      setError(apiError.message);
      setSaving(false);
    }
  };

  let hoursHelper = selected ? `${formatHours(selected.available_hours)} available during this project` : 'Up to 40 hours per week';
  if (invalidHours) hoursHelper = 'Enter between 0.5 and 40 hours';
  else if (overHours) hoursHelper = `Only ${formatHours(selected.available_hours)} available - this would exceed 40 hours per week`;
  else if (fieldError) hoursHelper = fieldError;

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSave} noValidate>
        <DialogTitle>{editing ? `Change hours for ${fullName(assignment)}` : 'Assign employee'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {options.status === 'error' && <Alert severity="error">{options.error.message}</Alert>}
            {!editing && (
              <Autocomplete
                options={choices}
                loading={options.status === 'loading'}
                value={selected}
                onChange={(_event, value) => setSelectedId(value?.user_id ?? null)}
                getOptionLabel={(option) => `${fullName(option)} (${option.employee_id})`}
                isOptionEqualToValue={(option, value) => option.user_id === value.user_id}
                renderOption={({ key, ...props }, option) => (
                  <Box component="li" key={key} {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <span>
                      {fullName(option)} <Typography component="span" variant="caption" color="text.secondary">{option.job_title}</Typography>
                    </span>
                    <Typography component="span" variant="caption" color={Number(option.available_hours) > 0 ? 'success.main' : 'error.main'}>
                      {formatHours(option.available_hours)} free
                    </Typography>
                  </Box>
                )}
                noOptionsText="No available employees"
                renderInput={(params) => <TextField {...params} label="Employee" required autoFocus />}
                disabled={saving}
              />
            )}
            <TextField
              label="Hours per week"
              type="number"
              required
              value={hours}
              onChange={(event) => {
                setHours(event.target.value);
                setFieldError(null);
              }}
              error={Boolean(invalidHours || overHours || fieldError)}
              helperText={hoursHelper}
              slotProps={{ htmlInput: { min: 0.5, max: MAX_HOURS, step: 0.5 } }}
              disabled={saving || !selected}
            />
            {needsApproval && (
              <Alert severity="info">
                {fullName(selected)} reports to {selected.manager_name}, so these hours need their approval.
                They are held for this project until {selected.manager_name} decides.
              </Alert>
            )}
            {selected && hours !== '' && !invalidHours && (
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  border: 1,
                  bgcolor: (theme) => (overBudget ? alpha(theme.palette.error.main, 0.06) : theme.palette.grey[50]),
                  borderColor: overBudget ? 'error.light' : 'divider',
                }}
              >
                <Stack spacing={0.75}>
                  <PreviewRow
                    label={editing ? 'Change in project cost' : 'Cost of this assignment'}
                    value={`${addedCost >= 0 ? '' : '−'}${formatCurrency(Math.abs(addedCost))}`}
                  />
                  <PreviewRow label="Projected labour cost" value={`${formatCurrency(costAfter)} of ${formatCurrency(project.budget)}`} />
                  <PreviewRow
                    label="Remaining budget"
                    value={formatCurrency(remainingAfter)}
                    tone={remainingAfter < 0 ? 'error.main' : 'success.main'}
                  />
                </Stack>
                {overBudget && (
                  <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
                    This would exceed the project budget. Reduce the hours or ask for a bigger budget.
                  </Typography>
                )}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!canSave}>
            {saving ? 'Saving…' : needsApproval ? 'Request approval' : editing ? 'Save hours' : 'Assign'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

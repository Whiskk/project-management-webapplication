import { useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useMediaQuery } from 'react-responsive';
import useApiResource from '../../hooks/useApiResource';
import { projectsApi } from '../../services/projectsApi';
import { fieldErrorsFrom } from '../../utils/format';

const UNASSIGNED = '';

/**
 * Add a task to a milestone, or edit one. The assignee list is the project's
 * approved team (the server enforces the same rule).
 */
export default function TaskDialog({ project, milestone, task, onClose, onSaved }) {
  const fullScreen = useMediaQuery({ maxWidth: 599 });
  const [values, setValues] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    assignee_id: task?.assignee?.id ?? UNASSIGNED,
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchTeam = useCallback((signal) => projectsApi.team(project.id, signal), [project.id]);
  const team = useApiResource(fetchTeam);
  const members = (team.data?.items ?? []).filter((member) => member.status === 'approved');

  const setField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!values.title.trim()) {
      setErrors({ title: 'Title is required' });
      return;
    }
    const payload = {
      title: values.title.trim(),
      description: values.description.trim(),
      assignee_id: values.assignee_id === UNASSIGNED ? null : Number(values.assignee_id),
    };
    setSaving(true);
    setSubmitError(null);
    try {
      const saved = task
        ? await projectsApi.updateTask(project.id, task.id, payload)
        : await projectsApi.createTask(project.id, milestone.id, payload);
      onSaved(saved);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setSubmitError(error.message);
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle>{task ? `Edit ${task.title}` : `New task in ${milestone.title}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <TextField
              label="Title"
              required
              autoFocus
              value={values.title}
              onChange={setField('title')}
              error={Boolean(errors.title)}
              helperText={errors.title}
              disabled={saving}
              slotProps={{ htmlInput: { maxLength: 200 } }}
              fullWidth
            />
            <TextField
              label="Notes"
              multiline
              minRows={2}
              value={values.description}
              onChange={setField('description')}
              disabled={saving}
              fullWidth
            />
            <TextField
              select
              label="Assignee"
              value={values.assignee_id}
              onChange={setField('assignee_id')}
              error={Boolean(errors.assignee_id)}
              helperText={errors.assignee_id || 'Anyone on this project\'s team (approved hours only)'}
              disabled={saving || team.status === 'loading'}
              fullWidth
            >
              <MenuItem value={UNASSIGNED}>Unassigned</MenuItem>
              {members.map((member) => (
                <MenuItem key={member.user_id} value={member.user_id}>
                  {member.first_name} {member.last_name}
                </MenuItem>
              ))}
              {/* A finished task keeps its assignee after they leave the team; keep them selectable. */}
              {task?.assignee && !members.some((m) => m.user_id === task.assignee.id) && (
                <MenuItem value={task.assignee.id}>{task.assignee.name} (not on the team)</MenuItem>
              )}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : task ? 'Save changes' : 'Add task'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

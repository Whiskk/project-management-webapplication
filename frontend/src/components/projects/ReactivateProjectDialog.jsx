import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import { projectsApi } from '../../services/projectsApi';
import ManagerSelect from '../users/ManagerSelect';

/**
 * Reactivate an archived project. If its manager is no longer active the API
 * refuses, and the dialog asks the admin to choose a new manager.
 */
export default function ReactivateProjectDialog({ project, onClose, onReactivated }) {
  const [needsManager, setNeedsManager] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (needsManager && !managerId) {
      setError('Choose a new manager to reactivate this project.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await projectsApi.reactivate(project.id, needsManager ? { manager_id: Number(managerId) } : {});
      onReactivated(saved);
    } catch (apiError) {
      if (apiError.status === 409 && apiError.details?.manager_id) setNeedsManager(true);
      setError(apiError.message);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reactivate project?</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            {project.name} will become editable again and visible to its manager and team.
          </DialogContentText>
          {error && <Alert severity={needsManager ? 'warning' : 'error'}>{error}</Alert>}
          {needsManager && (
            <ManagerSelect
              label="New project manager"
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
              disabled={busy}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={busy}>Reactivate</Button>
      </DialogActions>
    </Dialog>
  );
}

import { useCallback, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useNotify } from '../components/feedback/notificationContext';
import useApiResource from '../hooks/useApiResource';
import { refreshApprovalCount } from '../services/approvalCount';
import { projectsApi } from '../services/projectsApi';
import { formatDate, formatHours, fullName } from '../utils/format';

function describeChange(request) {
  return request.kind === 'new'
    ? `${formatHours(request.requested_hours)} per week (new assignment)`
    : `${formatHours(request.current_hours)} → ${formatHours(request.requested_hours)} per week`;
}

function RejectDialog({ request, busy, onConfirm, onClose }) {
  const [note, setNote] = useState('');
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reject request?</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            {request.kind === 'new'
              ? `${fullName(request)} will not be added to ${request.project_name}. The reserved hours are released.`
              : `${fullName(request)} stays at ${formatHours(request.current_hours)} per week on ${request.project_name}.`}
          </DialogContentText>
          <TextField
            label="Reason (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            helperText="Recorded in the audit log"
            disabled={busy}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button color="error" variant="contained" onClick={() => onConfirm(note.trim())} disabled={busy}>Reject</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Inbox of hour requests for the signed-in manager's direct reports. */
export default function ApprovalsPage() {
  const notify = useNotify();
  const fetchApprovals = useCallback((signal) => projectsApi.approvals(signal), []);
  const approvals = useApiResource(fetchApprovals);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const items = approvals.data?.items ?? [];

  const decide = async (request, action, note) => {
    setBusyId(request.assignment_id);
    try {
      if (action === 'approve') {
        await projectsApi.approve(request.project_id, request.assignment_id);
        notify(`Approved ${fullName(request)} on ${request.project_name}`, 'success');
      } else {
        await projectsApi.reject(request.project_id, request.assignment_id, note);
        notify(`Rejected request for ${fullName(request)}`, 'info');
      }
      approvals.reload();
      refreshApprovalCount();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusyId(null);
      setRejecting(null);
    }
  };

  return (
    <Stack spacing={3}>
      <div>
        <Typography variant="h1">Approvals</Typography>
        <Typography color="text.secondary">
          Other managers asking for your team's time. Requested hours are held until you decide.
        </Typography>
      </div>

      {approvals.status === 'loading' && <Skeleton variant="rounded" height={140} aria-label="Loading approvals" />}
      {approvals.status === 'error' && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={approvals.reload}>Retry</Button>}>
          {approvals.error.message}
        </Alert>
      )}
      {approvals.status === 'success' && items.length === 0 && (
        <Alert severity="success">You're all caught up. There are no requests waiting for you.</Alert>
      )}

      <Grid container spacing={2}>
        {items.map((request) => (
          <Grid key={request.assignment_id} size={{ xs: 12, md: 6 }}>
            <Card component="article" aria-label={`Request for ${fullName(request)} on ${request.project_name}`} sx={{ height: '100%' }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <div>
                    <Typography variant="h3" component="h2">{fullName(request)}</Typography>
                    <Typography variant="body2" color="text.secondary">{request.job_title || request.employee_id}</Typography>
                  </div>
                  <Chip size="small" color={request.kind === 'new' ? 'primary' : 'warning'} label={request.kind === 'new' ? 'New assignment' : 'Increase'} />
                </Stack>
                <Typography sx={{ mt: 2 }} fontWeight={600}>{describeChange(request)}</Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  on{' '}
                  <Link component={RouterLink} to={`/projects/${request.project_id}`}>{request.project_name}</Link>
                  {' '}({formatDate(request.start_date)} – {formatDate(request.predicted_end_date)})
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Requested by {request.requested_by_name} · project manager {request.project_manager_name}
                </Typography>
              </CardContent>
              <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}>
                <Button
                  color="error"
                  startIcon={<CloseIcon />}
                  onClick={() => setRejecting(request)}
                  disabled={busyId === request.assignment_id}
                >
                  Reject
                </Button>
                <Button
                  variant="contained"
                  startIcon={<CheckIcon />}
                  onClick={() => decide(request, 'approve')}
                  disabled={busyId === request.assignment_id}
                >
                  Approve
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {rejecting && (
        <RejectDialog
          request={rejecting}
          busy={busyId === rejecting.assignment_id}
          onConfirm={(note) => decide(rejecting, 'reject', note)}
          onClose={() => setRejecting(null)}
        />
      )}
    </Stack>
  );
}

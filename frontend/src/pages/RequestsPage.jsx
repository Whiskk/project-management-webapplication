import { useCallback, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import { useAuth } from '../auth/authContext';
import { can } from '../auth/permissions';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useNotify } from '../components/feedback/notificationContext';
import RequestFormDialog from '../components/requests/RequestFormDialog';
import ReviewRequestDialog from '../components/requests/ReviewRequestDialog';
import useApiResource from '../hooks/useApiResource';
import { projectsApi } from '../services/projectsApi';
import { refreshRequestCount } from '../services/requestCount';
import { formatCurrency, formatDate } from '../utils/format';

const STATUS_CHIPS = {
  pending: { label: 'Pending', color: 'warning' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'error' },
  withdrawn: { label: 'Withdrawn', color: 'default' },
};
const FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: '', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** Managers request new projects; admins approve (creating the project) or reject them. */
export default function RequestsPage() {
  const { user } = useAuth();
  const notify = useNotify();
  const isAdmin = can(user, 'requests.review');
  const [filter, setFilter] = useState(isAdmin ? 'pending' : '');
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(null); // { request, mode }
  const [withdrawing, setWithdrawing] = useState(null);
  const [busy, setBusy] = useState(false);

  const fetchRequests = useCallback((signal) => projectsApi.requests({ status: filter }, signal), [filter]);
  const requests = useApiResource(fetchRequests, { refreshInterval: 30_000 });
  const items = requests.data?.items ?? [];

  const refresh = () => {
    requests.reload();
    refreshRequestCount();
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await projectsApi.withdrawRequest(withdrawing.id);
      notify(`Request for '${withdrawing.name}' withdrawn`, 'info');
      refresh();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
      setWithdrawing(null);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <div>
          <Typography variant="h1">Project requests</Typography>
          <Typography color="text.secondary">
            {isAdmin ? 'Approve requests to create the project, or reject them with a reason.' : 'Ask an admin for a new project to manage.'}
          </Typography>
        </div>
        {can(user, 'requests.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New request</Button>
        )}
      </Stack>

      <Tabs value={filter} onChange={(_event, value) => setFilter(value)} aria-label="Filter requests" variant="scrollable">
        {FILTERS.map((option) => <Tab key={option.label} value={option.value} label={option.label} />)}
      </Tabs>

      {requests.status === 'loading' && <Skeleton variant="rounded" height={140} aria-label="Loading requests" />}
      {requests.status === 'error' && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={requests.reload}>Retry</Button>}>
          {requests.error.message}
        </Alert>
      )}
      {requests.status === 'success' && items.length === 0 && (
        <Alert severity="info">
          {filter === 'pending' ? 'No requests are waiting for a decision.' : 'No requests to show.'}
        </Alert>
      )}

      <Grid container spacing={2}>
        {items.map((request) => {
          const chip = STATUS_CHIPS[request.status];
          return (
            <Grid key={request.id} size={{ xs: 12, md: 6 }}>
              <Card component="article" aria-label={`Request for ${request.name}`} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <div>
                      <Typography variant="h3" component="h2">{request.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {isAdmin ? `Requested by ${request.requested_by_name} · ` : ''}{formatDate(request.created_at)}
                      </Typography>
                    </div>
                    <Chip size="small" color={chip.color} label={chip.label} />
                  </Stack>
                  <Typography sx={{ mt: 1.5 }} fontWeight={600}>
                    {formatCurrency(request.budget)} · {formatDate(request.start_date)} – {formatDate(request.predicted_end_date)}
                  </Typography>
                  {request.description && <Typography variant="body2" sx={{ mt: 1 }}>{request.description}</Typography>}
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic' }}>
                    “{request.justification}”
                  </Typography>
                  {request.status === 'approved' && request.project_id && (
                    <Typography variant="body2" sx={{ mt: 1.5 }}>
                      Approved by {request.reviewed_by_name}. Project created:{' '}
                      <Link component={RouterLink} to={`/projects/${request.project_id}`}>{request.project_name}</Link>
                    </Typography>
                  )}
                  {request.review_note && (
                    <Alert severity={request.status === 'rejected' ? 'error' : 'info'} sx={{ mt: 1.5 }}>
                      {request.reviewed_by_name}: {request.review_note}
                    </Alert>
                  )}
                </CardContent>
                {request.status === 'pending' && (
                  <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}>
                    {isAdmin ? (
                      <>
                        <Button color="error" onClick={() => setReviewing({ request, mode: 'reject' })}>Reject</Button>
                        <Button variant="contained" onClick={() => setReviewing({ request, mode: 'approve' })}>Approve</Button>
                      </>
                    ) : (
                      <Button onClick={() => setWithdrawing(request)}>Withdraw</Button>
                    )}
                  </CardActions>
                )}
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {creating && (
        <RequestFormDialog
          onClose={() => setCreating(false)}
          onSubmitted={(saved) => {
            setCreating(false);
            notify(`Request for '${saved.name}' sent to the admins`, 'success');
            refresh();
          }}
        />
      )}
      {reviewing && (
        <ReviewRequestDialog
          request={reviewing.request}
          mode={reviewing.mode}
          onClose={() => setReviewing(null)}
          onDone={(result) => {
            notify(reviewing.mode === 'approve' ? `Approved - project '${result.project_name}' created` : 'Request rejected', 'success');
            setReviewing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(withdrawing)}
        title="Withdraw request?"
        message={withdrawing ? `Your request for '${withdrawing.name}' will be withdrawn. You can submit a new one later.` : ''}
        confirmLabel="Withdraw"
        busy={busy}
        onConfirm={withdraw}
        onClose={() => setWithdrawing(null)}
      />
    </Stack>
  );
}

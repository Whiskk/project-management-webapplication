import { useCallback } from 'react';
import { Link as RouterLink } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAuth } from '../../auth/authContext';
import useApiResource from '../../hooks/useApiResource';
import { auditApi } from '../../services/auditApi';
import AuditTable from './AuditTable';

const RECENT = 10;

/** The latest audit entries for one project (admins; managers see their own and their team's), linking to the full log. */
export default function ProjectHistory({ projectId }) {
  const { user } = useAuth();
  const fetchHistory = useCallback(
    (signal) => auditApi.list({ project_id: projectId, page_size: RECENT }, signal),
    [projectId],
  );
  const history = useApiResource(fetchHistory);

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <div>
            <Typography variant="h3" component="h2">History</Typography>
            <Typography variant="body2" color="text.secondary">
              {user.role === 'manager'
                ? 'Recent activity on this project by you and your direct reports.'
                : 'Recent activity on this project, including denied attempts.'}
            </Typography>
          </div>
          <Button component={RouterLink} to={`/audit?project_id=${projectId}`}>View full history</Button>
        </Stack>
        {history.status === 'loading' && <Skeleton variant="rounded" height={80} aria-label="Loading history" />}
        {history.status === 'error' && <Alert severity="error">{history.error.message}</Alert>}
        {history.status === 'success' && (
          <AuditTable entries={history.data.items} showProject={false} emptyText="No activity recorded yet." />
        )}
      </CardContent>
    </Card>
  );
}

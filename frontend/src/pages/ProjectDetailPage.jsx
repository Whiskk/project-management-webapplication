import { useCallback, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArchiveIcon from '@mui/icons-material/Archive';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import { useAuth } from '../auth/authContext';
import { can } from '../auth/permissions';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useNotify } from '../components/feedback/notificationContext';
import ProjectFormDialog from '../components/projects/ProjectFormDialog';
import ProjectStatusChip from '../components/projects/ProjectStatusChip';
import ReactivateProjectDialog from '../components/projects/ReactivateProjectDialog';
import TeamSection from '../components/projects/TeamSection';
import useApiResource from '../hooks/useApiResource';
import { projectsApi } from '../services/projectsApi';
import { formatCurrency, formatDate, formatHours } from '../utils/format';

function Stat({ label, value, hint }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h3" component="p">{value}</Typography>
        {hint && <Typography variant="body2" color="text.secondary">{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

/** Budget against projected labour cost, with a usage bar. */
function BudgetStat({ project }) {
  const budget = Number(project.budget);
  const cost = Number(project.projected_cost);
  const used = budget > 0 ? Math.min((cost / budget) * 100, 100) : cost > 0 ? 100 : 0;
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="caption" color="text.secondary">Budget</Typography>
          {project.over_budget && <Chip size="small" color="error" label="Over budget" />}
        </Stack>
        <Typography variant="h3" component="p">{formatCurrency(budget)}</Typography>
        <LinearProgress
          variant="determinate"
          value={used}
          color={project.over_budget ? 'error' : used > 90 ? 'warning' : 'primary'}
          sx={{ my: 1, height: 6, borderRadius: 3 }}
          aria-label="Budget used"
        />
        <Typography variant="body2" color={project.over_budget ? 'error.main' : 'text.secondary'}>
          {formatCurrency(cost)} projected labour · {formatCurrency(project.remaining_budget)} left
        </Typography>
      </CardContent>
    </Card>
  );
}

/** Project overview with role-appropriate actions (edit, archive, reactivate) and the team. */
export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const notify = useNotify();
  const [dialog, setDialog] = useState(null); // 'edit' | 'archive' | 'reactivate'
  const [busy, setBusy] = useState(false);

  const fetchProject = useCallback((signal) => projectsApi.get(projectId, signal), [projectId]);
  const project = useApiResource(fetchProject);

  if (project.status === 'loading') {
    return (
      <Stack spacing={2}>
        <Skeleton variant="text" width={280} height={48} aria-label="Loading project" />
        <Skeleton variant="rounded" height={120} />
      </Stack>
    );
  }
  if (project.status === 'error') {
    const notFound = project.error.status === 404;
    return (
      <Stack spacing={2} alignItems="flex-start">
        <Alert
          severity={notFound ? 'warning' : 'error'}
          action={!notFound && <Button color="inherit" size="small" onClick={project.reload}>Retry</Button>}
        >
          {notFound ? 'This project does not exist or you do not have access to it.' : project.error.message}
        </Alert>
        <Button component={RouterLink} to="/projects" startIcon={<ArrowBackIcon />}>Back to projects</Button>
      </Stack>
    );
  }

  const data = project.data;
  const canEdit = !data.is_archived && (user.role === 'admin' || (user.role === 'manager' && data.manager_id === user.id));
  const canArchive = can(user, 'projects.archive');
  const showMoney = data.budget !== null;

  const archive = async () => {
    setBusy(true);
    try {
      await projectsApi.archive(data.id);
      notify(`${data.name} archived`, 'success');
      project.reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  return (
    <Stack spacing={3}>
      <Link component={RouterLink} to="/projects" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <ArrowBackIcon fontSize="small" /> Projects
      </Link>

      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <div>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h1">{data.name}</Typography>
            <ProjectStatusChip project={data} size="medium" />
          </Stack>
          <Typography color="text.secondary">Managed by {data.manager_name} ({data.manager_employee_id})</Typography>
        </div>
        <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
          {canEdit && (
            <Button variant="contained" startIcon={<EditIcon />} onClick={() => setDialog('edit')}>Edit</Button>
          )}
          {canArchive && !data.is_archived && (
            <Button color="error" variant="outlined" startIcon={<ArchiveIcon />} onClick={() => setDialog('archive')}>
              Archive
            </Button>
          )}
          {canArchive && data.is_archived && (
            <Button variant="contained" startIcon={<UnarchiveIcon />} onClick={() => setDialog('reactivate')}>
              Reactivate
            </Button>
          )}
        </Stack>
      </Stack>

      {data.is_archived && (
        <Alert severity="info">
          Archived on {formatDate(data.archived_at)}. Archived projects are read-only but all records are kept.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Stat label="Schedule" value={`${formatDate(data.start_date)} – ${formatDate(data.predicted_end_date)}`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Stat label="Working days" value={data.working_days} hint="Monday to Friday" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <Stat label="Capacity per person" value={`${data.capacity_hours} h`} hint="8 hours per working day" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          {showMoney
            ? <BudgetStat project={data} />
            : <Stat label="Your hours" value={formatHours(data.my_hours_per_week)} hint={`per week · team of ${data.team_size}`} />}
        </Grid>
      </Grid>

      <TeamSection
        project={data}
        canStaff={canEdit}
        showCosts={showMoney}
        onChanged={project.reload}
      />

      <Card>
        <CardContent>
          <Typography variant="h3" component="h2" gutterBottom>Description</Typography>
          <Typography color={data.description ? 'text.primary' : 'text.secondary'} sx={{ whiteSpace: 'pre-line' }}>
            {data.description || 'No description yet.'}
          </Typography>
        </CardContent>
      </Card>

      {dialog === 'edit' && (
        <ProjectFormDialog
          open
          project={data}
          editorRole={user.role}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            notify('Project updated', 'success');
            project.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === 'archive'}
        title="Archive project?"
        message="The project becomes read-only and is hidden from current lists and from its team. Nothing is deleted, and it can be reactivated later."
        confirmLabel="Archive"
        confirmColor="error"
        busy={busy}
        onConfirm={archive}
        onClose={() => setDialog(null)}
      />
      {dialog === 'reactivate' && (
        <ReactivateProjectDialog
          project={data}
          onClose={() => setDialog(null)}
          onReactivated={() => {
            setDialog(null);
            notify(`${data.name} reactivated`, 'success');
            project.reload();
          }}
        />
      )}
    </Stack>
  );
}

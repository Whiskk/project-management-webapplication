import { useCallback } from 'react';
import { Link as RouterLink } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useAuth } from '../auth/authContext';
import { ROLE_LABELS } from '../auth/permissions';
import BudgetCheckButton from '../components/dashboard/BudgetCheckButton';
import { AttentionList, CapacityBar, StatTile } from '../components/dashboard/DashboardWidgets';
import SystemStatus from '../components/dashboard/SystemStatus';
import useApiResource from '../hooks/useApiResource';
import { projectsApi } from '../services/projectsApi';
import { formatCurrency, formatDate, formatHours, fullName } from '../utils/format';

function AdminDashboard({ data, onRefresh }) {
  const { stats } = data;
  const committed = Number(stats.total_projected_cost);
  const budget = Number(stats.total_budget);
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 6, md: 3 }}><StatTile label="Active projects" value={stats.active_projects} to="/projects" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <StatTile label="Need attention" value={stats.needing_attention} tone={stats.needing_attention ? 'warning.main' : undefined} />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <StatTile label="Over budget" value={stats.over_budget} tone={stats.over_budget ? 'error.main' : undefined} />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <StatTile label="Requests to review" value={stats.pending_requests} to="/requests" tone={stats.pending_requests ? 'primary.main' : undefined} />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h3" component="h2" gutterBottom>Budget committed</Typography>
            <Typography variant="h2" component="p">{formatCurrency(committed)} <Typography component="span" color="text.secondary">of {formatCurrency(budget)}</Typography></Typography>
            <CapacityBar used={committed} capacity={budget || 1} label="Budget committed across active projects" />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
              Projected labour cost across active projects.
            </Typography>
            <BudgetCheckButton onDone={onRefresh} />
          </CardContent>
        </Card>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h3" component="h2" gutterBottom>People</Typography>
            <Stack direction="row" spacing={3}>
              {Object.entries(stats.people).map(([role, count]) => (
                <div key={role}>
                  <Typography variant="h2" component="p">{count}</Typography>
                  <Typography variant="body2" color="text.secondary">{ROLE_LABELS[role]}s</Typography>
                </div>
              ))}
            </Stack>
            <Button component={RouterLink} to="/users" size="small" sx={{ mt: 1 }}>Manage users</Button>
          </CardContent>
        </Card>
      </Grid>
      <Grid size={{ xs: 12, md: 8 }}>
        <AttentionList projects={data.attention} emptyText="Every active project is on budget and on schedule." />
      </Grid>
      <Grid size={{ xs: 12, md: 4 }}><SystemStatus /></Grid>
    </Grid>
  );
}

function ManagerDashboard({ data }) {
  const { stats } = data;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 6, md: 3 }}><StatTile label="My projects" value={stats.my_projects} to="/projects" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <StatTile label="Need attention" value={stats.needing_attention} tone={stats.needing_attention ? 'warning.main' : undefined} />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}>
        <StatTile label="Approvals waiting" value={stats.approvals_waiting} to="/approvals" tone={stats.approvals_waiting ? 'primary.main' : undefined} />
      </Grid>
      <Grid size={{ xs: 6, md: 3 }}><StatTile label="My pending requests" value={stats.my_pending_requests} to="/requests" /></Grid>
      <Grid size={{ xs: 12, md: 7 }}>
        <AttentionList projects={data.attention} emptyText="Your projects are on budget and on schedule." />
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h3" component="h2" gutterBottom>My team this week</Typography>
            {data.team.length === 0 ? (
              <Typography color="text.secondary">You have no direct reports.</Typography>
            ) : (
              <Stack spacing={1.5} component="ul" aria-label="Team load" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                {data.team.map((member) => (
                  <li key={member.id}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={600}>{fullName(member)}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {formatHours(member.hours_this_week)} of {formatHours(member.capacity)}
                      </Typography>
                    </Stack>
                    <CapacityBar used={member.hours_this_week} capacity={member.capacity} label={`${fullName(member)} hours this week`} />
                  </li>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

function EmployeeDashboard({ data }) {
  const { stats } = data;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 5 }}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h3" component="h2" gutterBottom>My week</Typography>
            <Typography variant="h2" component="p">
              {formatHours(stats.hours_this_week)} <Typography component="span" color="text.secondary">of {formatHours(stats.capacity)}</Typography>
            </Typography>
            <CapacityBar used={stats.hours_this_week} capacity={stats.capacity} label="My hours this week" />
            {Number(stats.hours_awaiting_approval) > 0 && (
              <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                {formatHours(stats.hours_awaiting_approval)} more awaiting your manager's approval
              </Typography>
            )}
          </CardContent>
        </Card>
      </Grid>
      <Grid size={{ xs: 12, md: 7 }}>
        <Card sx={{ height: '100%' }}>
          <CardContent>
            <Typography variant="h3" component="h2" gutterBottom>My projects</Typography>
            {data.projects.length === 0 ? (
              <Typography color="text.secondary">You are not assigned to any projects yet.</Typography>
            ) : (
              <List disablePadding aria-label="My projects">
                {data.projects.map((project) => (
                  <ListItem key={project.id} disableGutters divider>
                    <ListItemText
                      primary={<Link component={RouterLink} to={`/projects/${project.id}`} fontWeight={600}>{project.name}</Link>}
                      secondary={`Ends ${formatDate(project.predicted_end_date)} · ${project.milestones.completed}/${project.milestones.total} milestones done`}
                    />
                    {project.my_hours_per_week !== null
                      ? <Chip size="small" label={`${formatHours(project.my_hours_per_week)}/week`} />
                      : <Chip size="small" color="warning" variant="outlined" label="Pending approval" />}
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Grid>
      <Grid size={12}>
        <Card>
          <CardContent>
            <Typography variant="h3" component="h2" gutterBottom>Upcoming milestones</Typography>
            {data.upcoming_milestones.length === 0 ? (
              <Typography color="text.secondary">Nothing due on your projects.</Typography>
            ) : (
              <List disablePadding aria-label="Upcoming milestones">
                {data.upcoming_milestones.map((milestone) => (
                  <ListItem key={milestone.id} disableGutters divider>
                    <ListItemText primary={milestone.title} secondary={`${milestone.project_name} · due ${formatDate(milestone.due_date)}`} />
                    {milestone.overdue && <Chip size="small" color="error" label="Overdue" />}
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

const DASHBOARDS = { admin: AdminDashboard, manager: ManagerDashboard, employee: EmployeeDashboard };

/** Role dashboard: what each role needs to see first. */
export default function HomePage() {
  const { user } = useAuth();
  const fetchDashboard = useCallback((signal) => projectsApi.dashboard(signal), []);
  const dashboard = useApiResource(fetchDashboard, { refreshInterval: 30_000 });
  const Dashboard = DASHBOARDS[user?.role];

  return (
    <Stack spacing={3}>
      <div>
        <Typography variant="h1">Dashboard</Typography>
        {user && (
          <Typography color="text.secondary">
            Welcome back, {user.first_name}. You are signed in as {ROLE_LABELS[user.role]}.
          </Typography>
        )}
      </div>
      {dashboard.status === 'loading' && <Skeleton variant="rounded" height={220} aria-label="Loading dashboard" />}
      {dashboard.status === 'error' && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={dashboard.reload}>Retry</Button>}>
          {dashboard.error.message}
        </Alert>
      )}
      {dashboard.status === 'success' && Dashboard && <Dashboard data={dashboard.data} onRefresh={dashboard.reload} />}
    </Stack>
  );
}

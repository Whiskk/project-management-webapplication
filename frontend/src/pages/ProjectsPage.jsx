import { useCallback, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../auth/authContext';
import { can } from '../auth/permissions';
import { useNotify } from '../components/feedback/notificationContext';
import ProjectFormDialog from '../components/projects/ProjectFormDialog';
import ProjectStatusChip from '../components/projects/ProjectStatusChip';
import { PROJECT_STATUSES } from '../components/projects/projectStatuses';
import useApiResource from '../hooks/useApiResource';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { projectsApi } from '../services/projectsApi';
import { formatCurrency, formatDate, formatHours } from '../utils/format';

const DESKTOP_ONLY = { display: { xs: 'none', md: 'table-cell' } };

const COPY = {
  admin: { title: 'Projects', subtitle: 'Every project across the organisation.', empty: 'No projects match your filters.' },
  manager: { title: 'My projects', subtitle: 'Projects you manage.', empty: 'You do not manage any projects that match.' },
  employee: { title: 'My projects', subtitle: 'Projects you are assigned to.', empty: 'You are not assigned to any projects yet.' },
};

/** Project list, scoped by role on the server. Admins can create projects. */
export default function ProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notify = useNotify();
  const copy = COPY[user.role];
  const showBudget = user.role !== 'employee';
  const canSeeArchived = user.role !== 'employee';

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [archived, setArchived] = useState('false');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebouncedValue(search);

  const fetchProjects = useCallback(
    (signal) => projectsApi.list(
      { q: debouncedSearch, status, archived, page: page + 1, page_size: pageSize },
      signal,
    ),
    [debouncedSearch, status, archived, page, pageSize],
  );
  const projects = useApiResource(fetchProjects);
  const items = projects.data?.items ?? [];

  const onFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(0);
  };

  const columnCount = 7;

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <div>
          <Typography variant="h1">{copy.title}</Typography>
          <Typography color="text.secondary">{copy.subtitle}</Typography>
        </div>
        {can(user, 'projects.create') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          label="Search"
          placeholder="Name or description"
          value={search}
          onChange={onFilter(setSearch)}
          size="small"
          sx={{ minWidth: { md: 280 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <TextField select label="Status" value={status} onChange={onFilter(setStatus)} size="small" sx={{ minWidth: 150 }}>
          <MenuItem value="">All statuses</MenuItem>
          {Object.entries(PROJECT_STATUSES).map(([value, { label }]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
        {canSeeArchived && (
          <TextField select label="Show" value={archived} onChange={onFilter(setArchived)} size="small" sx={{ minWidth: 150 }}>
            <MenuItem value="false">Current projects</MenuItem>
            <MenuItem value="true">Archived</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
        )}
      </Stack>

      {projects.status === 'error' ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={projects.reload}>Retry</Button>}>
          {projects.error.message}
        </Alert>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small" aria-label="Projects">
              <TableHead>
                <TableRow>
                  <TableCell>Project</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell sx={DESKTOP_ONLY}>Manager</TableCell>
                  <TableCell sx={DESKTOP_ONLY}>Start</TableCell>
                  <TableCell>Predicted end</TableCell>
                  <TableCell sx={DESKTOP_ONLY} align="right">Team</TableCell>
                  {showBudget
                    ? <TableCell sx={DESKTOP_ONLY} align="right">Budget</TableCell>
                    : <TableCell align="right">My hours / week</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.status === 'loading' && Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell colSpan={columnCount}><Skeleton aria-label="Loading projects" /></TableCell>
                  </TableRow>
                ))}
                {projects.status === 'success' && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columnCount} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      {copy.empty}
                    </TableCell>
                  </TableRow>
                )}
                {projects.status === 'success' && items.map((project) => (
                  <TableRow
                    key={project.id}
                    hover
                    onClick={() => navigate(`/projects/${project.id}`)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      {/* The name is a real link so keyboard and screen-reader users can open the project. */}
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        component={RouterLink}
                        to={`/projects/${project.id}`}
                        onClick={(event) => event.stopPropagation()}
                        sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                      >
                        {project.name}
                      </Typography>
                      {project.description && (
                        <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ maxWidth: 320 }}>
                          {project.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell><ProjectStatusChip project={project} /></TableCell>
                    <TableCell sx={DESKTOP_ONLY}>{project.manager_name}</TableCell>
                    <TableCell sx={DESKTOP_ONLY}>{formatDate(project.start_date)}</TableCell>
                    <TableCell>{formatDate(project.predicted_end_date)}</TableCell>
                    <TableCell sx={DESKTOP_ONLY} align="right">{project.team_size}</TableCell>
                    {showBudget ? (
                      <TableCell sx={DESKTOP_ONLY} align="right">
                        {formatCurrency(project.budget)}
                        {project.over_budget && <Chip size="small" color="error" label="Over budget" sx={{ ml: 1 }} />}
                      </TableCell>
                    ) : (
                      <TableCell align="right">{formatHours(project.my_hours_per_week)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={projects.data?.total ?? 0}
            page={page}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_event, value) => setPage(value)}
            onRowsPerPageChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          />
        </Paper>
      )}

      {creating && (
        <ProjectFormDialog
          open
          project={null}
          editorRole={user.role}
          onClose={() => setCreating(false)}
          onSaved={(project) => {
            setCreating(false);
            notify(`Project ${project.name} created`, 'success');
            navigate(`/projects/${project.id}`);
          }}
        />
      )}
    </Stack>
  );
}

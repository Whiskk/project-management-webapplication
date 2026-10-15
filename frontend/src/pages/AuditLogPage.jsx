import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TablePagination from '@mui/material/TablePagination';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../auth/authContext';
import { ROLE_LABELS } from '../auth/permissions';
import AuditTable from '../components/audit/AuditTable';
import { useNotify } from '../components/feedback/notificationContext';
import useApiResource from '../hooks/useApiResource';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { saveBlob } from '../services/api';
import { EXPORT_LIMIT, auditApi } from '../services/auditApi';
import { todayIso } from '../utils/schedule';

const EMPTY_FILTERS = { q: '', action: '', role: '', outcome: '', from: '', to: '' };

/**
 * Read-only view of recorded actions, with filters. Admins see everything;
 * managers see their own and their direct reports' entries (the API enforces it).
 */
export default function AuditLogPage() {
  const { user } = useAuth();
  const notify = useNotify();
  const isManager = user.role === 'manager';
  // A manager's log only ever contains managers (themselves) and employees.
  const roleOptions = Object.entries(ROLE_LABELS).filter(([value]) => !isManager || value !== 'admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project_id') || '';
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const search = useDebouncedValue(filters.q);

  const fetchActions = useCallback((signal) => auditApi.actions(signal), []);
  const actions = useApiResource(fetchActions);

  const fetchEntries = useCallback(
    (signal) => auditApi.list({
      ...filters, q: search, project_id: projectId, page: page + 1, page_size: pageSize,
    }, signal),
    [filters, search, projectId, page, pageSize],
  );
  const entries = useApiResource(fetchEntries);

  const setFilter = (field) => (event) => {
    setFilters((current) => ({ ...current, [field]: event.target.value }));
    setPage(0);
  };
  const filtered = projectId || Object.values(filters).some(Boolean);
  const total = entries.data?.total ?? 0;
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await auditApi.exportCsv({ ...filters, q: search, project_id: projectId });
      saveBlob(blob, `audit-log-${todayIso()}.csv`);
      if (total > EXPORT_LIMIT) {
        notify(
          `Exported the newest ${EXPORT_LIMIT.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} entries. Narrow the dates to export older ones.`,
          'warning',
        );
      } else {
        notify(`Exported ${total.toLocaleString('en-US')} ${total === 1 ? 'entry' : 'entries'}`, 'success');
      }
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack spacing={3}>
      <div>
        <Typography variant="h1">Audit log</Typography>
        <Typography color="text.secondary">
          {isManager
            ? 'Your own activity and your direct reports\', newest first. Activity by other managers and admins is not shown.'
            : 'Every change, sign-in and denied attempt, newest first.'}
          {' '}Entries are permanent and cannot be edited or deleted.
        </Typography>
      </div>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <TextField
            label="Search"
            placeholder="Summary, name or employee ID"
            value={filters.q}
            onChange={setFilter('q')}
            size="small"
            fullWidth
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <TextField select label="Action" value={filters.action} onChange={setFilter('action')} size="small" fullWidth>
            <MenuItem value="">All actions</MenuItem>
            {(actions.data?.items ?? []).map((action) => <MenuItem key={action} value={action}>{action}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, sm: 3, md: 2.5 }}>
          <TextField select label="Role" value={filters.role} onChange={setFilter('role')} size="small" fullWidth>
            <MenuItem value="">All roles</MenuItem>
            {roleOptions.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, sm: 3, md: 2.5 }}>
          <TextField select label="Outcome" value={filters.outcome} onChange={setFilter('outcome')} size="small" fullWidth>
            <MenuItem value="">All outcomes</MenuItem>
            <MenuItem value="success">Succeeded</MenuItem>
            <MenuItem value="denied">Denied</MenuItem>
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField label="From" type="date" value={filters.from} onChange={setFilter('from')} size="small" fullWidth slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField label="To" type="date" value={filters.to} onChange={setFilter('to')} size="small" fullWidth slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 12, md: 8 }} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {projectId && (
            <Chip
              label={`Project #${projectId}`}
              onDelete={() => {
                setSearchParams({});
                setPage(0);
              }}
            />
          )}
          {filtered && (
            <Button
              size="small"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setSearchParams({});
                setPage(0);
              }}
            >
              Clear filters
            </Button>
          )}
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={exportCsv}
            disabled={exporting || entries.status !== 'success' || total === 0}
            sx={{ ml: { md: 'auto' } }}
          >
            {exporting ? 'Exporting…' : `Export CSV${filtered ? ' (filtered)' : ''}`}
          </Button>
        </Grid>
      </Grid>

      {entries.status === 'error' ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={entries.reload}>Retry</Button>}>
          {entries.error.message}
        </Alert>
      ) : (
        <Paper variant="outlined">
          {entries.status === 'loading'
            ? <Skeleton variant="rounded" height={200} aria-label="Loading audit log" sx={{ m: 2 }} />
            : <AuditTable entries={entries.data.items} />}
          <TablePagination
            component="div"
            count={entries.data?.total ?? 0}
            page={page}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[25, 50, 100, 200]}
            onPageChange={(_event, value) => setPage(value)}
            onRowsPerPageChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(0);
            }}
          />
        </Paper>
      )}
    </Stack>
  );
}

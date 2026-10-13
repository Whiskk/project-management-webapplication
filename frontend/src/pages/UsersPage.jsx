import { useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../auth/authContext';
import { can, ROLE_LABELS } from '../auth/permissions';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useNotify } from '../components/feedback/notificationContext';
import PasswordDialog from '../components/users/PasswordDialog';
import UserFormDialog from '../components/users/UserFormDialog';
import useApiResource from '../hooks/useApiResource';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { usersApi } from '../services/usersApi';
import { formatCurrency, fullName } from '../utils/format';

const ROLE_COLORS = { admin: 'secondary', manager: 'primary', employee: 'default' };
// Columns hidden on small screens to keep the table readable on phones.
const DESKTOP_ONLY = { display: { xs: 'none', md: 'table-cell' } };

/** User directory. Admins manage accounts; managers view users and edit their direct reports. */
export default function UsersPage() {
  const { user: me } = useAuth();
  const notify = useNotify();
  const isAdmin = can(me, 'users.manage');

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('active');
  const [reportsOnly, setReportsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const debouncedSearch = useDebouncedValue(search);

  const [menu, setMenu] = useState(null); // { anchor, user }
  const [editing, setEditing] = useState(null); // null | { user } (user null = create)
  const [confirming, setConfirming] = useState(null); // { user, action }
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);

  const fetchUsers = useCallback(
    (signal) => usersApi.list({
      q: debouncedSearch,
      role,
      status,
      manager_id: reportsOnly ? me.id : undefined,
      page: page + 1,
      page_size: pageSize,
    }, signal),
    [debouncedSearch, role, status, reportsOnly, me.id, page, pageSize],
  );
  const users = useApiResource(fetchUsers);

  const resetPage = (setter) => (event) => {
    setter(event.target.type === 'checkbox' ? event.target.checked : event.target.value);
    setPage(0);
  };

  const canEdit = (user) => isAdmin || user.manager_id === me.id;

  const handleSaved = (result) => {
    setEditing(null);
    users.reload();
    if (result.temporary_password) {
      setCredentials({
        title: 'User created',
        name: fullName(result.user),
        employeeId: result.user.employee_id,
        password: result.temporary_password,
      });
    } else {
      notify('Changes saved', 'success');
    }
  };

  const runConfirmed = async () => {
    const { user, action } = confirming;
    setBusy(true);
    try {
      if (action === 'reset') {
        const result = await usersApi.resetPassword(user.id);
        setCredentials({
          title: 'Password reset', name: fullName(user), employeeId: user.employee_id, password: result.temporary_password,
        });
      } else {
        await (action === 'deactivate' ? usersApi.deactivate(user.id) : usersApi.reactivate(user.id));
        notify(`${fullName(user)} ${action}d`, 'success');
      }
      users.reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const confirmText = {
    reset: { title: 'Reset password?', message: 'A new password will be generated. The old one stops working immediately.', label: 'Reset password' },
    deactivate: { title: 'Deactivate user?', message: 'They will no longer be able to sign in. Their records are kept and they can be reactivated later.', label: 'Deactivate' },
    reactivate: { title: 'Reactivate user?', message: 'They will be able to sign in again.', label: 'Reactivate' },
  }[confirming?.action] ?? {};

  const menuUser = menu?.user;
  const items = users.data?.items ?? [];

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
        <div>
          <Typography variant="h1">Users</Typography>
          <Typography color="text.secondary">
            {isAdmin ? 'Manage accounts, roles and reporting lines.' : 'Browse colleagues and update your direct reports.'}
          </Typography>
        </div>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({ user: null })}>
            New user
          </Button>
        )}
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        <TextField
          label="Search"
          placeholder="Name, email, ID or job title"
          value={search}
          onChange={resetPage(setSearch)}
          size="small"
          sx={{ minWidth: { md: 280 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <TextField select label="Role" value={role} onChange={resetPage(setRole)} size="small" sx={{ minWidth: 140 }}>
          <MenuItem value="">All roles</MenuItem>
          {Object.entries(ROLE_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
        {isAdmin && (
          <TextField select label="Status" value={status} onChange={resetPage(setStatus)} size="small" sx={{ minWidth: 140 }}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </TextField>
        )}
        {me.role === 'manager' && (
          <FormControlLabel
            control={<Switch checked={reportsOnly} onChange={resetPage(setReportsOnly)} />}
            label="My direct reports"
          />
        )}
      </Stack>

      {users.status === 'error' ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={users.reload}>Retry</Button>}>
          {users.error.message}
        </Alert>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small" aria-label="Users">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Employee ID</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell sx={DESKTOP_ONLY}>Job title</TableCell>
                  <TableCell sx={DESKTOP_ONLY}>Manager</TableCell>
                  <TableCell sx={DESKTOP_ONLY} align="right">Salary</TableCell>
                  <TableCell align="right"><Box component="span" sx={visuallyHidden}>Actions</Box></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.status === 'loading' && Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell colSpan={7}><Skeleton aria-label="Loading users" /></TableCell>
                  </TableRow>
                ))}
                {users.status === 'success' && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      No users match your filters.
                    </TableCell>
                  </TableRow>
                )}
                {users.status === 'success' && items.map((user) => (
                  <TableRow key={user.id} hover sx={{ opacity: user.is_active ? 1 : 0.6 }}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{fullName(user)}</Typography>
                      <Typography variant="caption" color="text.secondary">{user.email}</Typography>
                    </TableCell>
                    <TableCell>{user.employee_id}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Chip size="small" color={ROLE_COLORS[user.role]} label={ROLE_LABELS[user.role]} />
                        {!user.is_active && <Chip size="small" variant="outlined" label="Inactive" />}
                      </Stack>
                    </TableCell>
                    <TableCell sx={DESKTOP_ONLY}>{user.job_title || '—'}</TableCell>
                    <TableCell sx={DESKTOP_ONLY}>{user.manager_name || '—'}</TableCell>
                    <TableCell sx={DESKTOP_ONLY} align="right">{formatCurrency(user.salary)}</TableCell>
                    <TableCell align="right">
                      {canEdit(user) && (
                        <IconButton
                          size="small"
                          aria-label={`Actions for ${fullName(user)}`}
                          onClick={(event) => setMenu({ anchor: event.currentTarget, user })}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={users.data?.total ?? 0}
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

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setEditing({ user: menuUser }); setMenu(null); }}>Edit</MenuItem>
        {isAdmin && (
          <MenuItem onClick={() => { setConfirming({ user: menuUser, action: 'reset' }); setMenu(null); }}>
            Reset password
          </MenuItem>
        )}
        {isAdmin && menuUser && menuUser.id !== me.id && (
          <MenuItem
            onClick={() => {
              setConfirming({ user: menuUser, action: menuUser.is_active ? 'deactivate' : 'reactivate' });
              setMenu(null);
            }}
            sx={menuUser.is_active ? { color: 'error.main' } : undefined}
          >
            {menuUser.is_active ? 'Deactivate' : 'Reactivate'}
          </MenuItem>
        )}
      </Menu>

      {editing && (
        <UserFormDialog
          open
          user={editing.user}
          editorRole={me.role}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirming)}
        title={confirmText.title}
        message={confirmText.message}
        confirmLabel={confirmText.label}
        confirmColor={confirming?.action === 'deactivate' ? 'error' : 'primary'}
        busy={busy}
        onConfirm={runConfirmed}
        onClose={() => setConfirming(null)}
      />
      <PasswordDialog credentials={credentials} onClose={() => setCredentials(null)} />
    </Stack>
  );
}

import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import useApiResource from '../../hooks/useApiResource';
import { usersApi } from '../../services/usersApi';
import { fullName } from '../../utils/format';

const fetchManagers = (signal) => usersApi.list({ role: 'manager', page_size: 100 }, signal);

/** Dropdown of active managers, used wherever a manager must be chosen. */
export default function ManagerSelect({ label = 'Manager', value, onChange, error, helperText, disabled, required = true }) {
  const managers = useApiResource(fetchManagers);
  const loadError = managers.status === 'error' ? 'Could not load managers' : undefined;

  return (
    <TextField
      select
      fullWidth
      label={label}
      required={required}
      value={managers.status === 'success' ? value : ''}
      onChange={onChange}
      error={Boolean(error) || Boolean(loadError)}
      helperText={error || helperText || loadError}
      disabled={disabled || managers.status !== 'success'}
    >
      {(managers.data?.items ?? []).map((manager) => (
        <MenuItem key={manager.id} value={manager.id}>
          {fullName(manager)} ({manager.employee_id})
        </MenuItem>
      ))}
    </TextField>
  );
}

import { useCallback, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import useApiResource from '../../hooks/useApiResource';
import { projectsApi } from '../../services/projectsApi';
import { formatCurrency, formatHours, fullName } from '../../utils/format';
import ConfirmDialog from '../common/ConfirmDialog';
import { useNotify } from '../feedback/notificationContext';
import AssignmentDialog from './AssignmentDialog';

const DESKTOP_ONLY = { display: { xs: 'none', sm: 'table-cell' } };

/** Confirmed hours, plus any hours waiting for the employee's manager to approve. */
function HoursCell({ member }) {
  if (!member.awaiting_approval) return formatHours(member.hours_per_week);
  const isNew = member.hours_per_week === null;
  return (
    <Stack alignItems="flex-end" spacing={0.5}>
      <span>{isNew ? formatHours(member.pending_hours) : `${formatHours(member.hours_per_week)} → ${formatHours(member.pending_hours)}`}</span>
      <Tooltip title={`Requested by ${member.requested_by_name}. Hours are held until ${member.approver_name} decides.`}>
        <Chip size="small" color="warning" variant="outlined" label={`Awaiting ${member.approver_name}`} />
      </Tooltip>
    </Stack>
  );
}

/**
 * The project's team. Admins and the project's manager can assign people,
 * change hours and remove them; everyone else sees a read-only list.
 */
export default function TeamSection({ project, canStaff, showCosts, onChanged }) {
  const notify = useNotify();
  const fetchTeam = useCallback((signal) => projectsApi.team(project.id, signal), [project.id]);
  const team = useApiResource(fetchTeam);
  const [editing, setEditing] = useState(null); // null | { assignment } (assignment null = add)
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const members = team.data?.items ?? [];
  const columns = 3 + (showCosts ? 1 : 0) + (canStaff ? 1 : 0);

  const refresh = () => {
    team.reload();
    onChanged();
  };

  const remove = async () => {
    setBusy(true);
    try {
      await projectsApi.removeAssignment(project.id, removing.id);
      notify(`${fullName(removing)} removed from ${project.name}`, 'success');
      refresh();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <div>
            <Typography variant="h3" component="h2">Team</Typography>
            <Typography variant="body2" color="text.secondary">
              {formatHours(project.allocated_hours)} per week allocated · nobody can exceed 40 h per week
            </Typography>
          </div>
          {canStaff && (
            <Button startIcon={<PersonAddIcon />} variant="outlined" onClick={() => setEditing({ assignment: null })}>
              Assign
            </Button>
          )}
        </Stack>

        {team.status === 'error' ? (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={team.reload}>Retry</Button>}>
            {team.error.message}
          </Alert>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Team">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Hours / week</TableCell>
                  <TableCell align="right" sx={DESKTOP_ONLY}>Total hours</TableCell>
                  {showCosts && <TableCell align="right">Cost</TableCell>}
                  {canStaff && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {team.status === 'loading' && (
                  <TableRow><TableCell colSpan={columns}><Skeleton aria-label="Loading team" /></TableCell></TableRow>
                )}
                {team.status === 'success' && members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      Nobody is assigned yet.
                    </TableCell>
                  </TableRow>
                )}
                {team.status === 'success' && members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{fullName(member)}</Typography>
                      <Typography variant="caption" color="text.secondary">{member.job_title || member.employee_id}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <HoursCell member={member} />
                    </TableCell>
                    <TableCell align="right" sx={DESKTOP_ONLY}>{formatHours(member.total_hours)}</TableCell>
                    {showCosts && <TableCell align="right">{formatCurrency(member.cost)}</TableCell>}
                    {canStaff && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Change hours">
                          <IconButton size="small" aria-label={`Change hours for ${fullName(member)}`} onClick={() => setEditing({ assignment: member })}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove from project">
                          <IconButton size="small" aria-label={`Remove ${fullName(member)}`} onClick={() => setRemoving(member)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {editing && (
        <AssignmentDialog
          project={project}
          assignment={editing.assignment}
          onClose={() => setEditing(null)}
          onSaved={(employee, result) => {
            if (result.awaiting_approval) {
              notify(`Request sent to ${result.approver_name} for approval`, 'info');
            } else {
              notify(editing.assignment ? 'Hours updated' : `${fullName(employee)} assigned to ${project.name}`, 'success');
            }
            setEditing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove from project?"
        message={removing ? `${fullName(removing)} will be taken off ${project.name}. Their hours and cost are released.` : ''}
        confirmLabel="Remove"
        confirmColor="error"
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}

import { Fragment, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { ROLE_LABELS } from '../../auth/permissions';

const DESKTOP_ONLY = { display: { xs: 'none', md: 'table-cell' } };
const timestamp = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'medium' });

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Field-by-field before/after for one entry. */
function ChangesTable({ changes }) {
  const fields = Object.entries(changes);
  if (!fields.length) return <Typography variant="body2" color="text.secondary">No field changes recorded.</Typography>;
  return (
    <Table size="small" aria-label="Field changes">
      <TableHead>
        <TableRow>
          <TableCell>Field</TableCell>
          <TableCell>Before</TableCell>
          <TableCell>After</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {fields.map(([field, { from, to }]) => (
          <TableRow key={field}>
            <TableCell sx={{ fontFamily: 'monospace' }}>{field}</TableCell>
            <TableCell>{formatValue(from)}</TableCell>
            <TableCell>{formatValue(to)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Audit entries with expandable change details. `showProject` adds a project link column. */
export default function AuditTable({ entries, showProject = true, emptyText = 'No matching activity.' }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const columns = showProject ? 6 : 5;

  return (
    <TableContainer>
      <Table size="small" aria-label="Audit log">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox"><Box component="span" sx={visuallyHidden}>Details</Box></TableCell>
            <TableCell>When</TableCell>
            <TableCell>Who</TableCell>
            <TableCell>What happened</TableCell>
            <TableCell sx={DESKTOP_ONLY}>Action</TableCell>
            {showProject && <TableCell sx={DESKTOP_ONLY}>Project</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns} align="center" sx={{ py: 4, color: 'text.secondary' }}>{emptyText}</TableCell>
            </TableRow>
          )}
          {entries.map((entry) => {
            const expanded = open.has(entry.id);
            return (
              <Fragment key={entry.id}>
                <TableRow hover sx={entry.outcome === 'denied' ? { bgcolor: (theme) => alpha(theme.palette.error.main, 0.05) } : undefined}>
                  <TableCell padding="checkbox">
                    <IconButton size="small" aria-label={expanded ? 'Hide details' : 'Show details'} aria-expanded={expanded} onClick={() => toggle(entry.id)}>
                      {expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                    </IconButton>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{timestamp.format(new Date(entry.occurred_at))}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{entry.actor_name || 'Unknown (not signed in)'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {entry.actor_employee_id || '—'}{entry.actor_role && ` · ${ROLE_LABELS[entry.actor_role]}`}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {entry.outcome === 'denied' && <Chip size="small" color="error" label="Denied" sx={{ mr: 1 }} />}
                    {entry.summary}
                  </TableCell>
                  <TableCell sx={{ ...DESKTOP_ONLY, fontFamily: 'monospace', fontSize: 12 }}>{entry.action}</TableCell>
                  {showProject && (
                    <TableCell sx={DESKTOP_ONLY}>
                      {entry.project_id
                        ? <Link component={RouterLink} to={`/projects/${entry.project_id}`}>{entry.project_name || `#${entry.project_id}`}</Link>
                        : '—'}
                    </TableCell>
                  )}
                </TableRow>
                <TableRow>
                  <TableCell colSpan={columns} sx={{ py: 0, borderBottom: expanded ? undefined : 'none' }}>
                    <Collapse in={expanded} unmountOnExit>
                      <Box sx={{ py: 1.5, pl: { md: 6 } }}>
                        <ChangesTable changes={entry.changes} />
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

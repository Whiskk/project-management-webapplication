import { useCallback, useState } from 'react';
import { useMediaQuery } from 'react-responsive';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import useApiResource from '../../hooks/useApiResource';
import { projectsApi } from '../../services/projectsApi';
import { formatDate } from '../../utils/format';
import ConfirmDialog from '../common/ConfirmDialog';
import { useNotify } from '../feedback/notificationContext';
import MilestoneDialog from './MilestoneDialog';
import { MILESTONE_STATUSES } from './milestoneStatuses';

const DAY_MS = 24 * 60 * 60 * 1000;
const toDay = (iso) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS;
const BAR_COLORS = { not_started: 'grey.600', in_progress: 'primary.main', completed: 'success.main', blocked: 'error.main' };

/** Position (percent) of a date range within the timeline window. */
function barPosition(start, due, windowStart, windowDays) {
  const left = ((toDay(start) - windowStart) / windowDays) * 100;
  const width = ((toDay(due) - toDay(start) + 1) / windowDays) * 100;
  return { left: `${Math.max(left, 0)}%`, width: `${Math.max(width, 1)}%` };
}

function MilestoneFlags({ milestone }) {
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      <Chip size="small" color={MILESTONE_STATUSES[milestone.status].color} label={MILESTONE_STATUSES[milestone.status].label} />
      {milestone.overdue && <Chip size="small" color="error" variant="outlined" label="Overdue" />}
      {milestone.past_project_end && <Chip size="small" color="warning" variant="outlined" label="After project end" />}
      {milestone.status !== 'completed' && milestone.blocked_by.length > 0 && (
        <Tooltip title={`Waiting on: ${milestone.blocked_by.join(', ')}`}>
          <Chip size="small" variant="outlined" label={`Waiting on ${milestone.blocked_by.length}`} />
        </Tooltip>
      )}
    </Stack>
  );
}

/**
 * Project milestones as a Gantt-style timeline (bars across the project window,
 * with a "today" marker). On small screens the bars collapse into a list.
 */
export default function MilestonesSection({ project, canEdit, onChanged }) {
  const notify = useNotify();
  const isWide = useMediaQuery({ minWidth: 700 });
  const fetchMilestones = useCallback((signal) => projectsApi.milestones(project.id, signal), [project.id]);
  const milestones = useApiResource(fetchMilestones);
  const [editing, setEditing] = useState(null); // null | { milestone } (milestone null = add)
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  // Captured once on mount so rendering stays pure (the server computes 'overdue' itself).
  const [today] = useState(() => Math.floor(Date.now() / DAY_MS));

  const items = milestones.data?.items ?? [];
  const summary = milestones.data?.summary;

  // Timeline window: project start to whichever is later, predicted end or the last due date.
  const windowStart = toDay(project.start_date);
  const windowEnd = Math.max(toDay(project.predicted_end_date), ...items.map((m) => toDay(m.due_date)));
  const windowDays = windowEnd - windowStart + 1;
  const todayInWindow = today >= windowStart && today <= windowEnd;
  const endMarker = ((toDay(project.predicted_end_date) - windowStart + 1) / windowDays) * 100;

  const refresh = () => {
    milestones.reload();
    onChanged?.();
  };

  const remove = async () => {
    setBusy(true);
    try {
      await projectsApi.deleteMilestone(project.id, deleting.id);
      notify(`Milestone '${deleting.title}' deleted`, 'success');
      refresh();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mb: 2 }}>
          <div>
            <Typography variant="h3" component="h2">Milestones</Typography>
            {summary && summary.total > 0 && (
              <Typography variant="body2" color="text.secondary">
                {summary.completed} of {summary.total} completed ({summary.percent_complete}%)
                {summary.overdue > 0 && ` · ${summary.overdue} overdue`}
              </Typography>
            )}
          </div>
          {canEdit && (
            <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setEditing({ milestone: null })}>
              Add milestone
            </Button>
          )}
        </Stack>

        {summary && summary.total > 0 && (
          <LinearProgress
            variant="determinate"
            value={summary.percent_complete}
            color={summary.overdue > 0 ? 'warning' : 'success'}
            sx={{ height: 6, borderRadius: 0.5, mb: 2 }}
            aria-label="Milestones completed"
          />
        )}

        {milestones.status === 'loading' && <Skeleton variant="rounded" height={80} aria-label="Loading milestones" />}
        {milestones.status === 'error' && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={milestones.reload}>Retry</Button>}>
            {milestones.error.message}
          </Alert>
        )}
        {milestones.status === 'success' && items.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            No milestones yet.{canEdit && ' Add the first one to start tracking progress.'}
          </Typography>
        )}

        {milestones.status === 'success' && items.length > 0 && (
          <Stack component="ol" aria-label="Milestone timeline" sx={{ listStyle: 'none', m: 0, p: 0 }} spacing={1}>
            {items.map((milestone) => (
              <Box
                component="li"
                key={milestone.id}
                aria-label={milestone.title}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: isWide ? 'minmax(220px, 2fr) 3fr auto' : '1fr auto',
                  gap: 2,
                  alignItems: 'center',
                  py: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                }}
              >
                <div>
                  <Typography variant="body2" fontWeight={600}>{milestone.title}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {formatDate(milestone.start_date)} – {formatDate(milestone.due_date)}
                    {milestone.depends_on.length > 0 && ` · after ${milestone.depends_on.map((d) => d.title).join(', ')}`}
                  </Typography>
                  <Box sx={{ mt: 0.5 }}><MilestoneFlags milestone={milestone} /></Box>
                </div>

                {isWide && (
                  <Box sx={{ position: 'relative', height: 20, bgcolor: 'action.hover', borderRadius: 1 }} aria-hidden>
                    <Box sx={{ position: 'absolute', left: `${endMarker}%`, top: -4, bottom: -4, borderLeft: 1, borderColor: 'text.disabled', borderStyle: 'dashed' }} />
                    {todayInWindow && (
                      <Box sx={{ position: 'absolute', left: `${((today - windowStart) / windowDays) * 100}%`, top: -4, bottom: -4, borderLeft: 2, borderColor: 'secondary.main' }} />
                    )}
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 3,
                        height: 14,
                        borderRadius: 1,
                        bgcolor: BAR_COLORS[milestone.status],
                        outline: milestone.overdue ? 2 : 0,
                        outlineColor: 'error.main',
                        ...barPosition(milestone.start_date, milestone.due_date, windowStart, windowDays),
                      }}
                    />
                  </Box>
                )}

                {canEdit ? (
                  <Stack direction="row">
                    <Tooltip title="Edit">
                      <IconButton size="small" aria-label={`Edit ${milestone.title}`} onClick={() => setEditing({ milestone })}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={milestone.dependents.length ? 'Other milestones depend on this' : 'Delete'}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Delete ${milestone.title}`}
                          disabled={milestone.dependents.length > 0}
                          onClick={() => setDeleting(milestone)}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ) : <span />}
              </Box>
            ))}
          </Stack>
        )}

        {isWide && items.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Timeline {formatDate(project.start_date)} – {formatDate(new Date(windowEnd * DAY_MS).toISOString())}.
            Dashed line: predicted end. {todayInWindow && 'Solid line: today.'}
          </Typography>
        )}
      </CardContent>

      {editing && (
        <MilestoneDialog
          project={project}
          milestone={editing.milestone}
          milestones={items}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            notify(editing.milestone ? 'Milestone updated' : `Milestone '${saved.title}' added`, 'success');
            setEditing(null);
            refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete milestone?"
        message={deleting ? `'${deleting.title}' will be removed from ${project.name}. The audit log keeps a record.` : ''}
        confirmLabel="Delete"
        confirmColor="error"
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}

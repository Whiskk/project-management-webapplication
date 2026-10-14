import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import { projectsApi } from '../../services/projectsApi';
import ConfirmDialog from '../common/ConfirmDialog';
import { useNotify } from '../feedback/notificationContext';
import TaskDialog from './TaskDialog';

/** Why a task's checkbox is disabled, or null if it can be ticked. */
function tickBlocker(task, milestone) {
  if (!task.can_tick) return task.assignee ? `Only ${task.assignee.name} or the project manager can tick this off` : 'Only the project manager can tick off unassigned tasks';
  if (!task.done && task.waiting_on.length) return `Waiting on: ${task.waiting_on.join(', ')}`;
  if (task.done && milestone.status === 'completed') return 'Reopen the milestone to change its tasks';
  return null;
}

/**
 * A milestone's task checklist. Assignees (and the project manager or an admin)
 * tick tasks off; managers add, edit, reassign and delete them.
 */
export default function TaskChecklist({ project, milestone, canEdit, onChanged }) {
  const notify = useNotify();
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null); // null | { task } (task null = add)
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const tasks = milestone.tasks;

  const toggle = async (task) => {
    setBusyId(task.id);
    try {
      if (task.done) await projectsApi.reopenTask(project.id, task.id);
      else await projectsApi.completeTask(project.id, task.id);
      notify(task.done ? `Reopened '${task.title}'` : `Completed '${task.title}'`, 'success');
      onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    setDeletingBusy(true);
    try {
      await projectsApi.deleteTask(project.id, deleting.id);
      notify(`Task '${deleting.title}' deleted`, 'success');
      onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setDeletingBusy(false);
      setDeleting(null);
    }
  };

  return (
    <Box sx={{ pl: { sm: 1 }, pb: 1 }}>
      {tasks.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.5 }}>No tasks yet.</Typography>
      ) : (
        <Stack component="ul" aria-label={`Tasks in ${milestone.title}`} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {tasks.map((task) => {
            const blocker = tickBlocker(task, milestone);
            return (
              <Stack component="li" key={task.id} direction="row" alignItems="center" spacing={1} sx={{ minHeight: 40 }}>
                {/* describeChild: the reason is read as a description; the task title stays the checkbox's name. */}
                <Tooltip title={blocker ?? ''} disableHoverListener={!blocker} describeChild>
                  <FormControlLabel
                    sx={{ flexGrow: 1, mr: 0, minWidth: 0 }}
                    control={(
                      <Checkbox
                        checked={task.done}
                        onChange={() => toggle(task)}
                        disabled={Boolean(blocker) || busyId === task.id}
                        size="small"
                      />
                    )}
                    label={(
                      <Typography
                        variant="body2"
                        sx={{ textDecoration: task.done ? 'line-through' : 'none', color: task.done ? 'text.secondary' : 'text.primary' }}
                      >
                        {task.title}
                      </Typography>
                    )}
                  />
                </Tooltip>
                <Chip
                  size="small"
                  variant="outlined"
                  label={task.assignee ? task.assignee.name : 'Unassigned'}
                  sx={{ flexShrink: 0 }}
                />
                {canEdit && (
                  <Stack direction="row" sx={{ flexShrink: 0 }}>
                    <Tooltip title="Edit task">
                      <IconButton size="small" aria-label={`Edit task ${task.title}`} onClick={() => setEditing({ task })}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete task">
                      <IconButton size="small" aria-label={`Delete task ${task.title}`} onClick={() => setDeleting(task)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}

      {canEdit && (
        <Tooltip title={milestone.status === 'completed' ? 'Reopen the milestone to add tasks' : ''}>
          <span>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setEditing({ task: null })}
              disabled={milestone.status === 'completed'}
              sx={{ mt: 0.5 }}
            >
              Add task
            </Button>
          </span>
        </Tooltip>
      )}

      {editing && (
        <TaskDialog
          project={project}
          milestone={milestone}
          task={editing.task}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            notify(editing.task ? 'Task updated' : `Task '${saved.title}' added`, 'success');
            setEditing(null);
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete task?"
        message={deleting ? `'${deleting.title}' will be removed from ${milestone.title}. The audit log keeps a record.` : ''}
        confirmLabel="Delete"
        confirmColor="error"
        busy={deletingBusy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </Box>
  );
}

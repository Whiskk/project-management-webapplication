import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { projectsApi } from '../../services/projectsApi';
import { formatDate } from '../../utils/format';
import { useNotify } from '../feedback/notificationContext';

/** The signed-in employee's open tasks, ticked off right from the dashboard. */
export default function MyTasks({ tasks, onChanged }) {
  const notify = useNotify();
  const [busyId, setBusyId] = useState(null);

  const complete = async (task) => {
    setBusyId(task.id);
    try {
      await projectsApi.completeTask(task.project_id, task.id);
      notify(`Completed '${task.title}'`, 'success');
      onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h3" component="h2" gutterBottom>My tasks</Typography>
        {tasks.length === 0 ? (
          <Typography color="text.secondary">You have no open tasks.</Typography>
        ) : (
          <Stack component="ul" aria-label="My tasks" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {tasks.map((task) => {
              const labelId = `my-task-${task.id}`;
              return (
                <Stack component="li" key={task.id} direction="row" alignItems="flex-start" spacing={1} sx={{ py: 0.75, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'divider' } }}>
                  <Checkbox
                    checked={false}
                    onChange={() => complete(task)}
                    disabled={task.waiting || busyId === task.id}
                    slotProps={{ input: { 'aria-labelledby': labelId } }}
                    size="small"
                    sx={{ mt: -0.5 }}
                  />
                  <div>
                    <Typography id={labelId} variant="body2" fontWeight={600}>{task.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {task.milestone_title} · <Link component={RouterLink} to={`/projects/${task.project_id}`}>{task.project_name}</Link>
                      {' '}· due {formatDate(task.due_date)}
                    </Typography>
                    {task.waiting && (
                      <Typography variant="caption" color="warning.main">
                        Waiting on an earlier milestone to be completed
                      </Typography>
                    )}
                  </div>
                </Stack>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

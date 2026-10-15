import { Link as RouterLink } from 'react-router';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ScheduleIcon from '@mui/icons-material/Schedule';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import { formatDate, timeAgo } from '../../utils/format';

const ICONS = {
  assignment: <ScheduleIcon fontSize="small" />,
  task: <TaskAltIcon fontSize="small" />,
  project: <FolderOutlinedIcon fontSize="small" />,
  milestone: <FlagOutlinedIcon fontSize="small" />,
};

/** Recent changes that affect the employee (their hours, tasks and projects), made by someone else. */
export default function WhatsNew({ data }) {
  const items = data?.items ?? [];
  const intro = data?.since
    ? `Changes to your work by others. New since you last signed in (${formatDate(data.since)}) are marked.`
    : `Changes to your work by others in the last ${data?.window_days ?? 14} days.`;
  return (
    <Card component="section" aria-labelledby="whats-new-heading">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography id="whats-new-heading" variant="h3" component="h2">What's new</Typography>
          {data?.new_count > 0 && <Chip size="small" color="primary" label={`${data.new_count} new`} />}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{intro}</Typography>
        {items.length === 0 ? (
          <Typography color="text.secondary">Nothing has changed for you in the last {data?.window_days ?? 14} days.</Typography>
        ) : (
          <List dense disablePadding aria-label="What's new">
            {items.map((item) => (
              <ListItem key={item.id} disableGutters divider alignItems="flex-start">
                <ListItemIcon sx={{ minWidth: 36, mt: 0.75, color: item.is_new ? 'primary.main' : 'text.secondary' }} aria-hidden>
                  {ICONS[item.kind]}
                </ListItemIcon>
                <ListItemText
                  primary={(
                    <>
                      {item.is_new && <Chip size="small" color="primary" variant="outlined" label="New" sx={{ mr: 1, height: 20 }} />}
                      {item.text}
                    </>
                  )}
                  slotProps={{ primary: { fontWeight: item.is_new ? 600 : 400 } }}
                  secondary={(
                    <>
                      <time dateTime={item.occurred_at} title={new Date(item.occurred_at).toLocaleString()}>{timeAgo(item.occurred_at)}</time>
                      {item.project_id && (
                        <>
                          {' · '}
                          <Link component={RouterLink} to={`/projects/${item.project_id}`}>Open {item.project_name}</Link>
                        </>
                      )}
                    </>
                  )}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

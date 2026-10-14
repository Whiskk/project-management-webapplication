import { Link as RouterLink } from 'react-router';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { formatDate } from '../../utils/format';
import InsightList from '../projects/InsightList';

/** A headline number, optionally linking somewhere. */
export function StatTile({ label, value, hint, to, tone }) {
  const content = (
    <CardContent>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h2" component="p" color={tone}>{value}</Typography>
      {hint && <Typography variant="body2" color="text.secondary">{hint}</Typography>}
    </CardContent>
  );
  return (
    <Card sx={{ height: '100%' }}>
      {to ? <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>{content}</CardActionArea> : content}
    </Card>
  );
}

/** Hours used out of a weekly capacity, as a bar. */
export function CapacityBar({ used, capacity, label }) {
  const percent = Math.min((Number(used) / Number(capacity)) * 100, 100);
  return (
    <LinearProgress
      variant="determinate"
      value={percent}
      color={percent >= 100 ? 'error' : percent >= 80 ? 'warning' : 'primary'}
      sx={{ height: 8, borderRadius: 0.5 }}
      aria-label={label}
    />
  );
}

/** Projects with their insight chips; empty state when nothing needs attention. */
export function AttentionList({ projects, emptyText }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h3" component="h2" gutterBottom>Needs attention</Typography>
        {projects.length === 0 ? (
          <Typography color="text.secondary">{emptyText}</Typography>
        ) : (
          <List disablePadding aria-label="Projects needing attention">
            {projects.map((project) => (
              <ListItem key={project.id} disableGutters divider alignItems="flex-start">
                <ListItemText
                  primary={<Link component={RouterLink} to={`/projects/${project.id}`} fontWeight={600}>{project.name}</Link>}
                  secondary={
                    <Stack spacing={0.75} component="span" sx={{ mt: 0.5, display: 'flex' }}>
                      <span>{project.manager_name} · ends {formatDate(project.predicted_end_date)}</span>
                      <InsightList insights={project.insights.filter((i) => i.severity !== 'info')} />
                    </Stack>
                  }
                  slotProps={{ secondary: { component: 'div' } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}

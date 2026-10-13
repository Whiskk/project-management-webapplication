import Chip from '@mui/material/Chip';
import { PROJECT_STATUSES } from './projectStatuses';

/** Status badge for a project; archived projects are labelled as such. */
export default function ProjectStatusChip({ project, size = 'small' }) {
  if (project.is_archived) return <Chip size={size} variant="outlined" label="Archived" />;
  const status = PROJECT_STATUSES[project.status] ?? { label: project.status, color: 'default' };
  return <Chip size={size} color={status.color} label={status.label} />;
}

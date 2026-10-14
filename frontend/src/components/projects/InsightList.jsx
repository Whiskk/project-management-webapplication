import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';

const SHORT_LABELS = {
  over_budget: 'Over budget',
  budget_at_risk: 'Budget at risk',
  milestones_overdue: 'Overdue milestones',
  past_predicted_end: 'Past end date',
  milestones_past_end: 'Slipping',
  no_team: 'No team',
  no_milestones: 'No milestones',
  hours_awaiting_approval: 'Awaiting approval',
};

/**
 * Rule-based project insights (computed by the server from budget, schedule,
 * milestone and staffing rules - not AI).
 *
 * variant="alerts": full messages, for the project page.
 * variant="chips": compact labels with the message as a tooltip, for lists.
 */
export default function InsightList({ insights, variant = 'chips', max }) {
  const shown = max ? insights.slice(0, max) : insights;
  if (!shown.length) return null;

  if (variant === 'alerts') {
    return (
      <Stack spacing={1} aria-label="Project insights">
        {shown.map((insight) => (
          <Alert key={insight.code} severity={insight.severity}>{insight.message}</Alert>
        ))}
      </Stack>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {shown.map((insight) => (
        <Tooltip key={insight.code} title={insight.message}>
          <Chip
            size="small"
            variant={insight.severity === 'info' ? 'outlined' : 'filled'}
            color={insight.severity === 'info' ? 'default' : insight.severity}
            label={SHORT_LABELS[insight.code] ?? insight.code}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

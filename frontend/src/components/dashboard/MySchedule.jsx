import { Link as RouterLink } from 'react-router';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { formatDailyHours, formatDate, formatHours, formatShortDate } from '../../utils/format';
import { addDays, buildWeeks, percentAlong, todayIso, weeklyHours } from '../../utils/schedule';

const WEEKS = 12;
const WINDOW_DAYS = WEEKS * 7;
const MAX_WEEKLY_HOURS = 40;
// Project names stay pinned on the left while the weeks scroll sideways on small screens.
const COLUMNS = { xs: '150px 1fr', sm: '230px 1fr' };
const pinned = { position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper' };

// Week separators drawn behind every row of the timeline.
const weekLines = {
  backgroundImage: (theme) => `linear-gradient(to right, ${theme.palette.divider} 1px, transparent 1px)`,
  backgroundSize: `calc(100% / ${WEEKS}) 100%`,
};

/** "16 h/week · 3 h 12 min a day", or what is waiting for approval. */
function hoursText(project) {
  const confirmed = project.hours_per_week;
  if (confirmed === null) return `${formatHours(project.pending_hours)}/week awaiting approval`;
  return `${formatHours(confirmed)}/week · ${formatDailyHours(confirmed)} a day`;
}

function milestoneState(milestone, today) {
  if (milestone.status === 'completed') return { label: 'completed', color: 'text.disabled' };
  if (milestone.due_date < today) return { label: 'overdue', color: 'error.main' };
  return { label: 'due', color: 'text.primary' };
}

/** One project: label on the left; its bar, milestones and today's line across the weeks. */
function ProjectRow({ project, windowStart, windowEnd, today, todayAt }) {
  const pending = project.hours_per_week === null;
  const left = percentAlong(project.start_date, windowStart, WINDOW_DAYS);
  // The bar covers the whole of its last day.
  const right = percentAlong(addDays(project.predicted_end_date, 1), windowStart, WINDOW_DAYS);
  const startsLater = project.start_date >= windowEnd;
  const alreadyEnded = project.predicted_end_date < windowStart;
  const range = `${formatDate(project.start_date)} to ${formatDate(project.predicted_end_date)}`;

  return (
    <Box component="li" sx={{ display: 'grid', gridTemplateColumns: COLUMNS, minHeight: 56 }}>
      <Box sx={{ ...pinned, pr: 2, py: 1, borderTop: 1, borderColor: 'divider' }}>
        <Link component={RouterLink} to={`/projects/${project.project_id}`} fontWeight={600} variant="body2">
          {project.name}
        </Link>
        <Typography variant="caption" component="p" color={pending ? 'warning.main' : 'text.secondary'}>
          {hoursText(project)}
        </Typography>
        {!pending && project.pending_hours !== null && (
          <Typography variant="caption" component="p" color="warning.main">
            Increase to {formatHours(project.pending_hours)}/week awaiting approval
          </Typography>
        )}
      </Box>
      <Box sx={{ position: 'relative', borderTop: 1, borderColor: 'divider', ...weekLines }}>
        {startsLater || alreadyEnded ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ position: 'absolute', top: 16, left: `calc(${todayAt}% + 8px)`, zIndex: 1, px: 0.75, bgcolor: 'background.paper', whiteSpace: 'nowrap' }}
          >
            {startsLater ? `Starts ${formatDate(project.start_date)}` : `Predicted end was ${formatDate(project.predicted_end_date)}`}
          </Typography>
        ) : (
          <Box
            role="img"
            aria-label={`${project.name}: ${range}${pending ? ', awaiting approval' : ''}`}
            sx={{
              position: 'absolute',
              top: 18,
              height: 20,
              left: `${left}%`,
              width: `${Math.max(right - left, 0.8)}%`,
              borderRadius: 0.5,
              ...(pending
                ? { border: 2, borderStyle: 'dashed', borderColor: 'warning.main' }
                : { bgcolor: 'primary.dark' }),
            }}
          />
        )}
        {project.milestones
          .filter((m) => m.due_date >= windowStart && m.due_date < windowEnd)
          .map((milestone) => {
            const state = milestoneState(milestone, today);
            const label = `${milestone.title}: ${state.label} ${formatDate(milestone.due_date)}`;
            return (
              <Tooltip key={milestone.id} title={label}>
                <Box
                  role="img"
                  tabIndex={0}
                  aria-label={label}
                  sx={{
                    position: 'absolute',
                    top: 22,
                    left: `calc(${percentAlong(addDays(milestone.due_date, 1), windowStart, WINDOW_DAYS)}% - 6px)`,
                    width: 12,
                    height: 12,
                    transform: 'rotate(45deg)',
                    bgcolor: state.color,
                    border: 2,
                    borderColor: 'background.paper',
                    cursor: 'default',
                    '&:focus-visible': { outline: 2, outlineColor: 'primary.light', outlineStyle: 'solid' },
                  }}
                />
              </Tooltip>
            );
          })}
        <TodayLine at={todayAt} />
      </Box>
    </Box>
  );
}

function TodayLine({ at }) {
  return (
    <Box aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, left: `${at}%`, width: 2, bgcolor: 'secondary.main', opacity: 0.8 }} />
  );
}

/** Total hours each week against the 40-hour week; pending hours stacked on top. */
function LoadRow({ weeks }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: COLUMNS, borderTop: 1, borderColor: 'divider' }}>
      <Box sx={{ ...pinned, pr: 2, py: 1 }}>
        <Typography variant="body2" fontWeight={600}>My hours each week</Typography>
        <Typography variant="caption" color="text.secondary" component="p">of 40 (8 h a day)</Typography>
      </Box>
      <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, ...weekLines }}>
        {weeks.map((week, index) => {
          const total = week.confirmed + week.pending;
          const tone = total > MAX_WEEKLY_HOURS ? 'error.main' : total >= 36 ? 'warning.main' : 'text.primary';
          const pendingNote = week.pending ? `, plus ${formatHours(week.pending)} awaiting approval` : '';
          return (
            <Box
              key={week.start}
              role="img"
              aria-label={`Week of ${formatDate(week.start)}: ${formatHours(week.confirmed)} of 40${pendingNote}`}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', py: 1, gap: 0.5,
                ...(index === 0 && { bgcolor: 'action.hover' }),
              }}
            >
              <Box sx={{ width: '45%', height: 36, display: 'flex', flexDirection: 'column-reverse', bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                <Box sx={{ height: `${(Math.min(week.confirmed, MAX_WEEKLY_HOURS) / MAX_WEEKLY_HOURS) * 100}%`, bgcolor: 'primary.main' }} />
                <Box sx={{ height: `${(Math.min(week.pending, MAX_WEEKLY_HOURS) / MAX_WEEKLY_HOURS) * 100}%`, bgcolor: 'warning.main', opacity: 0.6 }} />
              </Box>
              <Typography variant="caption" color={tone} fontWeight={index === 0 ? 700 : 400} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {Number(total.toFixed(1))}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Legend() {
  const swatch = (sx) => <Box component="span" sx={{ display: 'inline-block', width: 14, height: 10, borderRadius: 0.5, mr: 0.75, verticalAlign: 'middle', ...sx }} />;
  const diamond = (color) => (
    <Box component="span" sx={{ display: 'inline-block', width: 9, height: 9, mr: 0.75, transform: 'rotate(45deg)', bgcolor: color, verticalAlign: 'middle' }} />
  );
  return (
    <Stack direction="row" flexWrap="wrap" columnGap={2.5} rowGap={0.5} sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{swatch({ bgcolor: 'primary.dark' })}On the project</Typography>
      <Typography variant="caption" color="text.secondary">{swatch({ border: 2, borderStyle: 'dashed', borderColor: 'warning.main' })}Awaiting approval</Typography>
      <Typography variant="caption" color="text.secondary">{diamond('text.primary')}Milestone due</Typography>
      <Typography variant="caption" color="text.secondary">{diamond('text.disabled')}Completed</Typography>
      <Typography variant="caption" color="text.secondary">{diamond('error.main')}Overdue</Typography>
      <Typography variant="caption" color="text.secondary">{swatch({ width: 3, bgcolor: 'secondary.main' })}Today</Typography>
    </Stack>
  );
}

/**
 * The employee's next 12 weeks: a bar per project for when they are on it,
 * its milestones, and their total hours each week against 40.
 */
export default function MySchedule({ schedule, today = todayIso() }) {
  const weeks = weeklyHours(schedule, buildWeeks(today, WEEKS));
  const windowStart = weeks[0].start;
  const windowEnd = addDays(windowStart, WINDOW_DAYS);
  const todayAt = percentAlong(today, windowStart, WINDOW_DAYS);

  return (
    <Card component="section" aria-labelledby="my-schedule-heading">
      <CardContent>
        <Typography id="my-schedule-heading" variant="h3" component="h2">My schedule</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The next 12 weeks: when you're on each project, what's due, and your hours each week.
        </Typography>
        {schedule.length === 0 ? (
          <Typography color="text.secondary">You aren't on any current projects.</Typography>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', md: 'none' }, mb: 1 }}>
              Swipe sideways to see all 12 weeks.
            </Typography>
            <Box role="region" aria-label="Schedule timeline" tabIndex={0} sx={{ overflowX: 'auto', '&:focus-visible': { outline: 2, outlineColor: 'primary.light', outlineStyle: 'solid' } }}>
              <Box sx={{ minWidth: { xs: 680, md: 760 } }}>
                <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: COLUMNS }}>
                  <Box sx={pinned} />
                  <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, pb: 0.5 }}>
                    {weeks.map((week, index) => (
                      <Typography key={week.start} variant="caption" color={index === 0 ? 'text.primary' : 'text.secondary'} sx={{ pl: 0.5, whiteSpace: 'nowrap' }}>
                        {index === 0 ? 'This week' : formatShortDate(week.start)}
                      </Typography>
                    ))}
                  </Box>
                </Box>
                <Box component="ul" aria-label="My projects over the next 12 weeks" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {schedule.map((project) => (
                    <ProjectRow
                      key={project.project_id}
                      project={project}
                      windowStart={windowStart}
                      windowEnd={windowEnd}
                      today={today}
                      todayAt={todayAt}
                    />
                  ))}
                </Box>
                <LoadRow weeks={weeks} />
              </Box>
            </Box>
            <Legend />
          </>
        )}
      </CardContent>
    </Card>
  );
}

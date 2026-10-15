import { Link as RouterLink } from 'react-router';
import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
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
// Each day gets a fixed width, so days are easy to tell apart; the weeks scroll sideways
// while project names stay pinned on the left.
const DAY_PX = 22;
const WEEK_PX = DAY_PX * 7;
const TRACK_PX = WEEK_PX * WEEKS;
const COLUMNS = { xs: `150px ${TRACK_PX}px`, sm: `230px ${TRACK_PX}px` };
const pinned = { position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper' };
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Drawn behind every row: strong lines between weeks, faint lines between days, shaded weekends.
const dayGrid = {
  backgroundImage: (theme) => [
    `linear-gradient(to right, ${theme.palette.divider} 1px, transparent 1px)`,
    `linear-gradient(to right, ${alpha(theme.palette.text.secondary, 0.12)} 1px, transparent 1px)`,
    `linear-gradient(to right, transparent ${5 * DAY_PX}px, ${theme.palette.action.hover} ${5 * DAY_PX}px)`,
  ].join(', '),
  backgroundSize: `${WEEK_PX}px 100%, ${DAY_PX}px 100%, ${WEEK_PX}px 100%`,
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
      <Box sx={{ position: 'relative', borderTop: 1, borderColor: 'divider', ...dayGrid }}>
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
                    // Centred on its due day.
                    left: `calc(${percentAlong(milestone.due_date, windowStart, WINDOW_DAYS)}% + ${DAY_PX / 2 - 6}px)`,
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
      <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, ${WEEK_PX}px)`, ...dayGrid }}>
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
                // The bar spans Monday to Friday, lining up with the working days above.
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-end', py: 1, pl: '3px', gap: 0.5,
                ...(index === 0 && { bgcolor: 'action.hover' }),
              }}
            >
              <Box sx={{ width: 5 * DAY_PX - 6, height: 36, display: 'flex', flexDirection: 'column-reverse', bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
                <Box sx={{ height: `${(Math.min(week.confirmed, MAX_WEEKLY_HOURS) / MAX_WEEKLY_HOURS) * 100}%`, bgcolor: 'primary.main' }} />
                <Box sx={{ height: `${(Math.min(week.pending, MAX_WEEKLY_HOURS) / MAX_WEEKLY_HOURS) * 100}%`, bgcolor: 'warning.main', opacity: 0.6 }} />
              </Box>
              <Typography variant="caption" color={tone} fontWeight={index === 0 ? 700 : 400} sx={{ fontVariantNumeric: 'tabular-nums', width: 5 * DAY_PX - 6, textAlign: 'center' }}>
                {Number(total.toFixed(1))} h
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
  // Today's line sits in the middle of today's column.
  const todayAt = percentAlong(today, windowStart, WINDOW_DAYS) + 100 / WINDOW_DAYS / 2;
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(windowStart, i));

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
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
              Scroll sideways to see all 12 weeks. Weekends are shaded.
            </Typography>
            <Box role="region" aria-label="Schedule timeline" tabIndex={0} sx={{ overflowX: 'auto', '&:focus-visible': { outline: 2, outlineColor: 'primary.light', outlineStyle: 'solid' } }}>
              <Box sx={{ width: 'max-content' }}>
                <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: COLUMNS }}>
                  <Box sx={pinned} />
                  <Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, ${WEEK_PX}px)` }}>
                      {weeks.map((week, index) => (
                        <Typography
                          key={week.start}
                          variant="caption"
                          fontWeight={index === 0 ? 600 : 400}
                          color={index === 0 ? 'text.primary' : 'text.secondary'}
                          sx={{ pl: 0.75, whiteSpace: 'nowrap', borderLeft: 1, borderColor: 'divider' }}
                        >
                          {index === 0 ? `This week · ${formatShortDate(week.start)}` : `Week of ${formatShortDate(week.start)}`}
                        </Typography>
                      ))}
                    </Box>
                    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${WINDOW_DAYS}, ${DAY_PX}px)`, pb: 0.5 }}>
                      {days.map((day, index) => {
                        const isToday = day === today;
                        const weekend = index % 7 >= 5;
                        return (
                          <Box
                            key={day}
                            sx={{
                              textAlign: 'center',
                              lineHeight: 1.15,
                              fontSize: '0.68rem',
                              py: 0.25,
                              borderRadius: 0.5,
                              color: isToday ? 'secondary.contrastText' : weekend ? 'text.disabled' : 'text.secondary',
                              bgcolor: isToday ? 'secondary.main' : 'transparent',
                              fontWeight: isToday ? 700 : 400,
                            }}
                          >
                            <div>{DAY_LETTERS[index % 7]}</div>
                            <div>{Number(day.slice(8))}</div>
                          </Box>
                        );
                      })}
                    </Box>
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

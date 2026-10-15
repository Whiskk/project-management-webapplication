import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import InputAdornment from '@mui/material/InputAdornment';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SearchIcon from '@mui/icons-material/Search';
import { useAuth } from '../auth/authContext';
import InfoTip from '../components/common/InfoTip';
import useApiResource from '../hooks/useApiResource';
import { projectsApi } from '../services/projectsApi';
import { formatDate, formatHours, formatShortDate, fullName } from '../utils/format';
import { addDays, todayIso, weekStart } from '../utils/schedule';

const WEEKS = 12;
const STEP_DAYS = 28; // Earlier / Later move four weeks
const pinned = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' };
const pendingStripes = (theme) => `repeating-linear-gradient(135deg, ${theme.palette.warning.main} 0 3px, ${alpha(theme.palette.warning.main, 0.35)} 3px 6px)`;

/** How free a week is, for the cell's tint (the text always says the number too). */
function tone(week) {
  if (Number(week.free) === 0) return 'error';
  if (Number(week.free) < 8) return 'warning';
  return 'success';
}

function WeekCell({ week, capacity }) {
  const booked = Number(week.booked);
  const free = Number(week.free);
  const percent = (value) => `${(Math.min(Number(value), capacity) / capacity) * 100}%`;
  const pendingNote = Number(week.pending) ? `, including ${formatHours(week.pending)} awaiting approval` : '';
  return (
    <Box
      component="td"
      sx={{
        p: 0.75,
        borderBottom: 1,
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: (theme) => alpha(theme.palette[tone(week)].main, free === 0 ? 0.14 : free < 8 ? 0.12 : 0.06),
        minWidth: 84,
        verticalAlign: 'top',
      }}
    >
      <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }} aria-hidden>
        {free === 0 ? 'Full' : `${formatHours(free)} free`}
      </Typography>
      <Box aria-hidden sx={{ display: 'flex', height: 6, mt: 0.5, bgcolor: 'action.hover', borderRadius: 0.5, overflow: 'hidden' }}>
        <Box sx={{ width: percent(week.confirmed), bgcolor: 'primary.main' }} />
        <Box sx={{ width: percent(week.pending), backgroundImage: pendingStripes }} />
      </Box>
      <Typography variant="caption" color="text.secondary" aria-hidden sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatHours(booked)} booked
      </Typography>
      <Box component="span" sx={visuallyHidden}>
        {free === 0 ? 'Fully booked' : `${formatHours(free)} free`}: {formatHours(booked)} of {capacity} booked{pendingNote}
      </Box>
    </Box>
  );
}

function Legend() {
  const swatch = (sx) => <Box component="span" sx={{ display: 'inline-block', width: 14, height: 10, borderRadius: 0.5, mr: 0.75, verticalAlign: 'middle', ...sx }} />;
  return (
    <Stack direction="row" flexWrap="wrap" columnGap={2.5} rowGap={0.5} sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{swatch({ bgcolor: 'primary.main' })}Confirmed hours</Typography>
      <Typography variant="caption" color="text.secondary">{swatch({ backgroundImage: pendingStripes })}Awaiting approval (already reserved)</Typography>
      <Typography variant="caption" color="text.secondary">{swatch({ bgcolor: (t) => alpha(t.palette.success.main, 0.2) })}8 h or more free</Typography>
      <Typography variant="caption" color="text.secondary">{swatch({ bgcolor: (t) => alpha(t.palette.warning.main, 0.3) })}Under 8 h free</Typography>
      <Typography variant="caption" color="text.secondary">{swatch({ bgcolor: (t) => alpha(t.palette.error.main, 0.3) })}Full (40 h)</Typography>
    </Stack>
  );
}

/**
 * Who is free when: every active employee's booked hours per week, for
 * planning staffing. Managers can narrow it to their own team.
 */
export default function AvailabilityPage() {
  const { user } = useAuth();
  const isManager = user.role === 'manager';
  const thisWeek = weekStart(todayIso());
  // The first week can come from the URL (?start=2033-05-09), so a window can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('start');
  const start = /^\d{4}-\d{2}-\d{2}$/.test(requested ?? '') && !Number.isNaN(Date.parse(requested))
    ? weekStart(requested)
    : thisWeek;
  const setStart = (monday) => setSearchParams(monday === thisWeek ? {} : { start: monday }, { replace: true });
  const [scope, setScope] = useState(isManager ? 'team' : 'all');
  const [search, setSearch] = useState('');

  const fetchAvailability = useCallback(
    (signal) => projectsApi.availability({ start, weeks: WEEKS }, signal),
    [start],
  );
  const availability = useApiResource(fetchAvailability, { refreshInterval: 30_000 });
  const data = availability.data;

  const people = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.people ?? []).filter((person) => (
      (scope === 'all' || person.is_my_report)
      && (!term || `${fullName(person)} ${person.employee_id} ${person.job_title ?? ''}`.toLowerCase().includes(term))
    ));
  }, [data, scope, search]);
  const hasReports = (data?.people ?? []).some((person) => person.is_my_report);

  return (
    <Stack spacing={3}>
      <div>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography variant="h1">Team availability</Typography>
          <InfoTip topic="availability" />
        </Stack>
        <Typography color="text.secondary">
          Free hours per employee each week (Monday to Friday) across all current projects, out of 40. Use it to see who can take on work before you staff a project.
        </Typography>
      </div>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        {isManager && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={scope}
            onChange={(_event, value) => value && setScope(value)}
            aria-label="Who to show"
          >
            <ToggleButton value="team">My team</ToggleButton>
            <ToggleButton value="all">Everyone</ToggleButton>
          </ToggleButtonGroup>
        )}
        <TextField
          label="Search"
          placeholder="Name, employee ID or job title"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          size="small"
          sx={{ minWidth: { md: 280 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <Stack direction="row" spacing={1} sx={{ ml: { md: 'auto' } }}>
          <Button size="small" startIcon={<ChevronLeftIcon />} onClick={() => setStart(addDays(start, -STEP_DAYS))}>Earlier</Button>
          <Button size="small" onClick={() => setStart(thisWeek)} disabled={start === thisWeek}>This week</Button>
          <Button size="small" endIcon={<ChevronRightIcon />} onClick={() => setStart(addDays(start, STEP_DAYS))}>Later</Button>
        </Stack>
      </Stack>

      {availability.status === 'error' ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={availability.reload}>Retry</Button>}>
          {availability.error.message}
        </Alert>
      ) : (
        <Card>
          <CardContent>
            {availability.status === 'loading' ? (
              <Skeleton variant="rounded" height={240} aria-label="Loading availability" />
            ) : (
              <>
                {isManager && scope === 'team' && !hasReports && (
                  <Alert severity="info" sx={{ mb: 2 }}>You have no direct reports. Choose Everyone to see the whole company.</Alert>
                )}
                {people.length === 0 ? (
                  (scope === 'all' || hasReports) && <Typography color="text.secondary">No employees match.</Typography>
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                      {formatDate(data.weeks[0].start)} to {formatDate(data.weeks.at(-1).end)}. Scroll sideways to see all {WEEKS} weeks.
                    </Typography>
                    <Box
                      role="region"
                      aria-label="Availability table"
                      tabIndex={0}
                      sx={{ overflowX: 'auto', '&:focus-visible': { outline: 2, outlineColor: 'primary.light', outlineStyle: 'solid' } }}
                    >
                      <Box component="table" sx={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content', minWidth: '100%' }}>
                        <caption style={visuallyHidden}>Free and booked hours per employee for each week</caption>
                        <thead>
                          <tr>
                            <Box component="th" scope="col" sx={{ ...pinned, zIndex: 2, textAlign: 'left', p: 1, borderBottom: 1, borderColor: 'divider' }}>
                              <Typography variant="caption" fontWeight={600}>Employee</Typography>
                            </Box>
                            {data.weeks.map((week) => {
                              const current = week.start === thisWeek;
                              return (
                                <Box
                                  component="th"
                                  scope="col"
                                  key={week.start}
                                  sx={{ p: 1, textAlign: 'left', borderBottom: 1, borderLeft: 1, borderColor: 'divider', whiteSpace: 'nowrap', bgcolor: current ? 'action.selected' : undefined }}
                                >
                                  <Typography variant="caption" fontWeight={current ? 700 : 600} color={current ? 'text.primary' : 'text.secondary'}>
                                    {current ? 'This week' : 'Week of'}
                                    <br />
                                    {formatShortDate(week.start)}
                                  </Typography>
                                </Box>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {people.map((person) => (
                            <tr key={person.user_id}>
                              <Box component="th" scope="row" sx={{ ...pinned, textAlign: 'left', p: 1, pr: 2, borderBottom: 1, borderColor: 'divider', minWidth: { xs: 140, sm: 220 }, fontWeight: 400 }}>
                                <Typography variant="body2" fontWeight={600}>{fullName(person)}</Typography>
                                <Typography variant="caption" color="text.secondary" component="p">
                                  {[person.job_title, person.employee_id].filter(Boolean).join(' · ')}
                                </Typography>
                                {person.is_my_report
                                  ? <Chip size="small" label="Your report" sx={{ mt: 0.5 }} />
                                  : person.manager_name && (
                                    <Typography variant="caption" color="text.secondary" component="p">
                                      Reports to {person.manager_name}
                                    </Typography>
                                  )}
                              </Box>
                              {person.weeks.map((week, index) => (
                                <WeekCell key={data.weeks[index].start} week={week} capacity={Number(data.capacity)} />
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </Box>
                    </Box>
                    <Legend />
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

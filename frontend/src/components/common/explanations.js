/**
 * Plain-language explanations of the app's figures, shown by <InfoTip>.
 * They describe the rules the API enforces (see README → Business rules).
 */
export const EXPLANATIONS = {
  budget: {
    title: 'Projected labour cost',
    body: [
      'For each person on the project: hours per week × working weeks × their hourly rate (annual salary ÷ 2,080, which is 52 weeks of 40 hours).',
      'Hours awaiting approval count too, so the money is held while the request waits.',
      'The budget is a hard limit: adding people, raising hours, cutting the budget or extending the dates past it is refused. A pay rise is never blocked, but it can push a project over, which flags it in red.',
    ],
  },
  capacity: {
    title: 'Capacity per person',
    body: [
      'Working days (Monday to Friday) × 8 hours: the most one person could give this project working on it full time.',
    ],
  },
  weeklyHours: {
    title: 'The 40-hour rule',
    body: [
      'Nobody can be booked for more than 40 hours in any week across all their current projects.',
      'Only projects that overlap count: 30 h in January and 30 h in March never add up, so a January to March project can still take 10 h.',
      'Hours awaiting approval are reserved: they already count towards the 40 hours and the budget, so approving can never break either rule.',
    ],
  },
  myWeek: {
    title: 'My week',
    body: [
      'The hours per week from every project running this week, added up. A full week is 40 hours: 8 hours a day, Monday to Friday.',
      '"About … a day" spreads the weekly hours over 5 working days.',
      'Hours awaiting approval were requested by another manager and are waiting for your own manager to agree.',
    ],
  },
  committed: {
    title: 'Budget committed',
    body: [
      'The projected labour cost of every active project (not archived or completed), against the total of their budgets.',
      'Projected labour cost = hours per week × working weeks × hourly rate (annual salary ÷ 2,080), with hours awaiting approval included.',
    ],
  },
  availability: {
    title: 'Team availability',
    body: [
      'Each cell is the hours an employee is booked for that week (Monday to Friday) across all current projects, out of 40.',
      'It uses the busiest day of the week, the same way the 40-hour rule does, so a project ending on Tuesday and another starting on Wednesday are not added together.',
      'Striped hours are awaiting approval: they are already reserved, so they are not free.',
    ],
  },
};

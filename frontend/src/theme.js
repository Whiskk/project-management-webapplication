import { alpha, createTheme } from '@mui/material/styles';

// Dark slate surfaces with a deep green accent. Filled surfaces (buttons, chips)
// use the deep green with white text (5.3:1); text, links and outlines on the dark
// background use a lighter green from the same hue (6.5:1). Secondary is a muted steel.
const GREEN = '#3aaa7a';
const GREEN_DEEP = '#1f7a52';
const GREEN_DEEPER = '#1b6b47';
const STEEL = '#8aa0c2';

// Outlines of inputs and outlined buttons: at least 3:1 against their surface (WCAG 1.4.11).
const CONTROL_BORDER = '#64748b';
const CONTROL_BORDER_HOVER = '#8b9bb3';

const surface = {
  base: '#0b1120', // page background
  raised: '#111a2e', // cards, tables, dialogs
  sidebar: '#0e1627',
  border: 'rgba(148, 163, 184, 0.14)',
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: GREEN, light: '#6cc79b', dark: GREEN_DEEP, contrastText: '#0b1120' },
    secondary: { main: STEEL, light: '#a9bad4', dark: '#64799c', contrastText: '#0b1120' },
    error: { main: '#f26d6d' },
    warning: { main: '#f0a24a' },
    success: { main: '#3fbf7f' },
    info: { main: '#5aa9e6' },
    background: { default: surface.base, paper: surface.raised },
    divider: surface.border,
    text: { primary: '#e6ebf3', secondary: '#94a3b8' },
    action: { hover: 'rgba(148, 163, 184, 0.08)', selected: alpha(GREEN, 0.14) },
  },
  // Tighter corners throughout: 4px base, 6px for larger surfaces.
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontSize: '1.75rem', fontWeight: 650, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.01em' },
    h3: { fontSize: '1.125rem', fontWeight: 600 },
    h6: { fontWeight: 650, letterSpacing: '-0.01em' },
    button: { fontWeight: 600 },
    caption: { letterSpacing: '0.01em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { colorScheme: 'dark' },
        body: {
          backgroundColor: surface.base,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          scrollbarColor: 'rgba(148, 163, 184, 0.3) transparent',
        },
      },
    },
    // Dark-mode MUI lightens elevated paper with a white overlay; flat borders read cleaner.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: surface.border },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 6, borderColor: surface.border } },
    },
    MuiCardActionArea: {
      styleOverrides: { root: { '&:hover .MuiCardActionArea-focusHighlight': { opacity: 0.04 } } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: alpha(surface.base, 0.85),
          backdropFilter: 'blur(10px)',
          borderBottom: `1px solid ${surface.border}`,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundColor: surface.sidebar, borderRight: `1px solid ${surface.border}` },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 4 },
        outlined: { borderColor: CONTROL_BORDER },
        // Filled primary buttons use the deep green with white text.
        containedPrimary: {
          backgroundColor: GREEN_DEEP,
          color: '#ffffff',
          '&:hover': { backgroundColor: GREEN_DEEPER },
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 4 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(148, 163, 184, 0.04)',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: CONTROL_BORDER },
          '&:hover:not(.Mui-disabled, .Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: CONTROL_BORDER_HOVER },
        },
        // Browser autofill paints inputs bright blue; keep them on the dark surface.
        input: {
          '&::placeholder': { color: '#94a3b8', opacity: 1 },
          '&:-webkit-autofill': {
            WebkitBoxShadow: `0 0 0 100px ${surface.raised} inset`,
            WebkitTextFillColor: '#e6ebf3',
            caretColor: '#e6ebf3',
            borderRadius: 'inherit',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: surface.border },
        head: {
          color: '#94a3b8',
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          backgroundColor: 'rgba(148, 163, 184, 0.04)',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: { root: { '&:last-child td': { borderBottom: 0 } } },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500, borderRadius: 4 },
        filledPrimary: { backgroundColor: GREEN_DEEP, color: '#ffffff' },
      },
    },
    // Loading placeholders carry an aria-label ("Loading projects"); the progressbar
    // role makes that label valid and announced. Decorative ones set aria-hidden.
    MuiSkeleton: { defaultProps: { role: 'progressbar' } },
    MuiTabs: {
      styleOverrides: { root: { borderBottom: `1px solid ${surface.border}` } },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 48 } } },
    MuiDialog: {
      styleOverrides: { paper: { border: `1px solid ${surface.border}`, borderRadius: 6 } },
    },
    MuiMenu: {
      styleOverrides: { paper: { border: `1px solid ${surface.border}`, marginTop: 6 } },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 4, alignItems: 'center' },
        // Filled alerts (the pop-up notifications): deep backgrounds with white text, all above 5:1.
        filledSuccess: { backgroundColor: GREEN_DEEP, color: '#ffffff' },
        filledError: { backgroundColor: '#b3261e', color: '#ffffff' },
        filledWarning: { backgroundColor: '#9a5b00', color: '#ffffff' },
        filledInfo: { backgroundColor: '#1d5fa8', color: '#ffffff' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: '#1e293b', border: `1px solid ${surface.border}`, fontSize: '0.75rem' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { backgroundColor: 'rgba(148, 163, 184, 0.14)' } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 4 } },
    },
  },
});

export default theme;

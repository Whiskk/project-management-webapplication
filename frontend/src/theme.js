import { alpha, createTheme } from '@mui/material/styles';

// Dark slate surfaces with a soft, muted orange as the accent (dark text on it,
// so filled buttons stay calm rather than glaring) and a quiet teal secondary.
const BRAND_ORANGE = '#e0915a';
const BRAND_TEAL = '#3aa6a8';

const surface = {
  base: '#0b1120', // page background
  raised: '#111a2e', // cards, tables, dialogs
  sidebar: '#0e1627',
  border: 'rgba(148, 163, 184, 0.14)',
};

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: BRAND_ORANGE, light: '#ecb085', dark: '#b8693a', contrastText: '#1a1410' },
    secondary: { main: BRAND_TEAL, light: '#66c3c4', dark: '#23797b', contrastText: '#0b1418' },
    error: { main: '#f26d6d' },
    warning: { main: '#f0a24a' },
    success: { main: '#3fbf7f' },
    info: { main: '#5aa9e6' },
    background: { default: surface.base, paper: surface.raised },
    divider: surface.border,
    text: { primary: '#e6ebf3', secondary: '#94a3b8' },
    action: { hover: 'rgba(148, 163, 184, 0.08)', selected: alpha(BRAND_ORANGE, 0.14) },
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
        outlined: { borderColor: 'rgba(148, 163, 184, 0.3)' },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 4 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(148, 163, 184, 0.04)',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.24)' },
          '&:hover:not(.Mui-disabled, .Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(148, 163, 184, 0.45)' },
        },
        // Browser autofill paints inputs bright blue; keep them on the dark surface.
        input: {
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
    MuiChip: { styleOverrides: { root: { fontWeight: 500, borderRadius: 4 } } },
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
      styleOverrides: { root: { borderRadius: 4, alignItems: 'center' } },
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

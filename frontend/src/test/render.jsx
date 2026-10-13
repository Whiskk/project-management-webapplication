import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import NotificationProvider from '../components/feedback/NotificationProvider';
import theme from '../theme';

/** Render a component with the app's providers and an in-memory router. */
export function renderWithProviders(ui, { route = '/' } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </NotificationProvider>
    </ThemeProvider>,
  );
}

import { useId } from 'react';
import Box from '@mui/material/Box';

/** The app logo (same mark as the favicon), decorative next to the product name. */
export default function BrandMark({ size = 30 }) {
  // A unique gradient id per instance: a shared id breaks when the first copy is hidden.
  const gradientId = useId();
  return (
    <Box
      component="svg"
      viewBox="0 0 32 32"
      aria-hidden
      sx={{ width: size, height: size, flexShrink: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f9e6e" />
          <stop offset="1" stopColor="#1b6b47" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6" fill={`url(#${gradientId})`} />
      <rect x="7" y="9" width="12" height="3" rx="1.5" fill="#ffffff" />
      <rect x="7" y="15" width="18" height="3" rx="1.5" fill="#ffffff" />
      <rect x="7" y="21" width="8" height="3" rx="1.5" fill="#ffffff" />
    </Box>
  );
}

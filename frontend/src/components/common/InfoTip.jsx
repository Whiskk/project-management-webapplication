import { useId, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { EXPLANATIONS } from './explanations';

/**
 * A small "ⓘ" button that explains how a figure is worked out.
 *
 * A click/tap toggletip rather than a hover tooltip, so it works on touch
 * screens and from the keyboard (Enter opens, Esc closes and returns focus).
 */
export default function InfoTip({ topic, sx }) {
  const [anchor, setAnchor] = useState(null);
  const id = useId();
  const { title, body } = EXPLANATIONS[topic];
  return (
    <>
      <IconButton
        size="small"
        aria-label={`About ${title.toLowerCase()}`}
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? id : undefined}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        sx={{ p: 0.25, color: 'text.secondary', ...sx }}
      >
        <InfoOutlinedIcon fontSize="inherit" />
      </IconButton>
      <Popover
        id={id}
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': title, sx: { p: 2, maxWidth: 340 } } }}
      >
        <Typography variant="subtitle2" component="h2" gutterBottom>{title}</Typography>
        {body.map((paragraph) => (
          <Typography key={paragraph} variant="body2" color="text.secondary" sx={{ '& + &': { mt: 1 } }}>
            {paragraph}
          </Typography>
        ))}
      </Popover>
    </>
  );
}

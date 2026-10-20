import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarcodeSvg } from './barcode-svg';

describe('BarcodeSvg', () => {
  it('draws an EAN-13 barcode with its digits underneath', () => {
    render(<BarcodeSvg value="2000000000015" />);
    expect(screen.getByRole('img', { name: 'Barcode 2000000000015' })).toBeInTheDocument();
    expect(screen.getByText('2 000000 000015')).toBeInTheDocument();
  });

  it('shows any other barcode as plain text instead of drawing a wrong one', () => {
    render(<BarcodeSvg value="MFR-123456" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('MFR-123456')).toBeInTheDocument();
  });
});

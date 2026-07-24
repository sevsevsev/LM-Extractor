/**
 * Brand tokens for UI chrome and PDF export.
 * SDP is the default profile; swap values here (or load a different profile) for other orgs.
 */
export interface BrandConfig {
  id: string;
  shortName: string;
  editionLabel: string;
  productName: string;
  pdfFilenameSuffix: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    highlight: string;
    mutedBg: string;
  };
}

export const brand: BrandConfig = {
  id: 'sdp',
  shortName: 'SDP',
  editionLabel: 'SDP Edition',
  productName: 'Logic Model Refiner',
  pdfFilenameSuffix: 'SDP_Branded',
  colors: {
    primary: '#0b315b',
    secondary: '#22779f',
    accent: '#47aad8',
    highlight: '#ffaa30',
    mutedBg: '#F2F2F2',
  },
};

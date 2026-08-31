/**
 * Brand tokens for UI chrome and PDF export.
 * SDP palette from Brand Quick Guide; OSP lockup in /public/brand/osp-logo.jpg.
 * Do not recolor or distort the Independence Hall icon.
 */
export interface BrandConfig {
  id: string;
  shortName: string;
  officeName: string;
  productName: string;
  pdfFilenameSuffix: string;
  logoSrc: string;
  logoAlt: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    sky: string;
    highlight: string;
    gray: string;
    mutedBg: string;
    error: string;
    success: string;
  };
}

export const brand: BrandConfig = {
  id: 'sdp',
  shortName: 'SDP',
  officeName: 'Office of Strategic Partnerships',
  productName: 'Logic Model Extractor',
  pdfFilenameSuffix: 'SDP_Branded',
  logoSrc: '/brand/osp-logo.jpg',
  logoAlt: 'The School District of Philadelphia, Office of Strategic Partnerships',
  colors: {
    primary: '#0b315b',
    secondary: '#22779f',
    accent: '#47aad8',
    sky: '#6dcff6',
    highlight: '#ffaa30',
    gray: '#707687',
    mutedBg: '#F2F2F2',
    error: '#99082e',
    success: '#398635',
  },
};

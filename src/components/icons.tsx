import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, p: P) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p });

export const IconDashboard = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
export const IconClipboard = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 11l2 2 4-4" />
  </svg>
);
export const IconPlus = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconStore = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6" />
  </svg>
);
export const IconUsers = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-5-6.3" />
  </svg>
);
export const IconList = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
export const IconHistory = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M3 12a9 9 0 109-9 9.5 9.5 0 00-6.5 2.6L3 8M3 3v5h5M12 7v5l3 2" />
  </svg>
);
export const IconUser = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0116 0" />
  </svg>
);
export const IconLogout = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
  </svg>
);
export const IconBell = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2M10 20a2 2 0 004 0" />
  </svg>
);
export const IconCamera = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconCheck = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M5 12l4 4L19 7" />
  </svg>
);
export const IconChart = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
  </svg>
);
export const IconAlert = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />
  </svg>
);
export const IconCalendar = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const IconSparkle = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM5 18l.7 2 2 .7-2 .7L5 23l-.7-1.6-2-.7 2-.7z" />
  </svg>
);
export const IconChevron = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const IconBook = ({ size = 20, ...p }: P) => (
  <svg {...base(size, p)}>
    <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5M8 3v16" />
  </svg>
);

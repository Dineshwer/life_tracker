import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});

export const IconToday = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>);
export const IconHabits = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 18c3-1 4-5 8-5s5 4 8 5" /><path d="M12 13V5" /><path d="M12 8c-2 0-3-1-3-3 2 0 3 1 3 3Z" /></svg>);
export const IconTasks = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 7h14M5 12h14M5 17h8" /></svg>);
export const IconGym = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 12h18M6 8v8M18 8v8M9 10v4M15 10v4" /></svg>);
export const IconJournal = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6z" /><path d="M9 4v16M12 9h3" /></svg>);
export const IconCharacter = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="9" r="3.5" /><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" /></svg>);
export const IconRewards = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9z" /></svg>);
export const IconSettings = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 8h10M18 8h2M4 16h2M10 16h10" /><circle cx="16" cy="8" r="2" /><circle cx="8" cy="16" r="2" /></svg>);
export const IconPlus = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>);
export const IconCheck = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>);
export const IconClose = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconSun = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>);
export const IconMoon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" /></svg>);
export const IconFlame = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9Z" /></svg>);
export const IconTrophy = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6" /></svg>);
export const IconRejection = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="6" y="3" width="12" height="18" rx="1.5" /><path d="M14.5 12h.01" /><path d="M3 21h18" /></svg>);
export const IconMore = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>);

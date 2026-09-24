/** Domain constants shared by all functions. Keep in sync with src/utils/constants.ts (frontend). */

export const PLATFORMS = ['TikTok', 'Instagram', 'YouTube'];

export const PLATFORM_HOSTS = {
  TikTok: ['tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com'],
  Instagram: ['instagram.com', 'instagr.am'],
  YouTube: ['youtube.com', 'youtu.be'],
};

export const SOURCE_TYPES = ['content', 'account', 'hashtag'];

export const CATEGORIES = [
  'paint',
  'interior',
  'exterior',
  'waterproofing',
  'renovation',
  'color-trend',
  'home-decor',
  'building-material',
];

export const PRODUCTS = ['Interior paint', 'Exterior paint', 'Waterproof', 'Primer'];
export const AUDIENCES = ['Home owner', 'Contractor', 'Architect'];
export const OBJECTIVES = ['Awareness', 'Engagement', 'Leads', 'Sales', 'Education'];
export const CONTENT_FORMATS = ['Short video', 'Carousel', 'Single image', 'Story', 'Live', 'Long video'];
export const IMPACT_LEVELS = ['High', 'Medium', 'Low'];
export const GROWTH_LEVELS = ['Viral', 'Rising', 'Stable', 'Declining'];
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

export const VIDEO_TEMPLATES = {
  before_after: {
    label: 'Before After House Transformation',
    brief: 'Dramatic transformation of a dull, peeling or faded Indonesian house into a freshly painted modern home. Start with the "before" condition, show the painting process, end with the stunning "after" reveal.',
  },
  product_education: {
    label: 'Product Education',
    brief: 'Clear, trustworthy explanation of a paint product: benefits, correct application steps, coverage, drying time and common mistakes to avoid.',
  },
  store_promotion: {
    label: 'Store Promotion',
    brief: 'Energetic promotion for a paint retail store: product range, color mixing/tinting service, friendly staff, promo call-to-action to visit the store.',
  },
  customer_testimonial: {
    label: 'Customer Testimonial',
    brief: 'Authentic testimonial: a homeowner or contractor shares the problem they had, why they chose the product/store, and the result they are proud of.',
  },
  color_inspiration: {
    label: 'Color Inspiration',
    brief: 'Aesthetic color inspiration: curated color palettes for rooms and facades, mood and lighting, how the colors make the home feel more premium.',
  },
};
export const TEMPLATE_IDS = Object.keys(VIDEO_TEMPLATES);

export const VIDEO_DURATIONS = [15, 30, 60];
export const VIDEO_RATIOS = ['9:16'];
export const VIDEO_STYLES = ['Realistic', 'Cinematic'];
export const VIDEO_STATUSES = ['Draft', 'Processing', 'Completed', 'Published', 'Failed'];

/** Output resolution per aspect ratio. */
export const RATIO_RESOLUTION = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 1080, height: 1080 },
};

export const SCRIPT_DURATIONS = [15, 30, 60];
export const SCRIPT_TONES = ['Friendly', 'Professional', 'Inspirational', 'Humorous', 'Urgent'];
